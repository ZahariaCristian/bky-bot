const {
  firstStepBody,
  pageGetHeader,
  firstPostHeader,
  secondPostHeader,
  secondStepBody,
  thirdStepBody,
  thirdPostHeader,
} = require("../../helpers/dataComposer");
const {
  fetchWithRetry,
  extract_csrf,
  extract_params,
  extract_images,
} = require("../../helpers/common");
var fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const { Signale } = require("signale");
const { default: axios } = require("axios");
const { prepareUploadImage, unlinkImages } = require("../../imageProcessor");
const { canContinueWithRejectedImages } = require("../../imageCompatibility");
const {
  collectPictureCandidates,
  responseBodySnippet,
  summarizeImageResponse,
} = require("./imageResponse");
const options = {
  types: {
    debug: {
      color: "grey",
    },
  },
};
const logger = new Signale(options);
const BASE_URL = "https://bari.bakecaincontrii.com";
const IMAGE_UPLOAD_MAX_ATTEMPTS = 3;
const rawImageUploadDelay = Number.parseInt(
  process.env.BAKECAINCONTRII_IMAGE_UPLOAD_DELAY_MS || "750",
  10
);
const IMAGE_UPLOAD_DELAY_MS = Number.isFinite(rawImageUploadDelay)
  ? Math.min(Math.max(rawImageUploadDelay, 0), 5000)
  : 750;

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const getCookie = (jHeader) => {
  var cookie = "";
  for (var key in jHeader) {
    cookie += `${key}=${jHeader[key]};`;
  }
  return cookie;
};

const summarizeAdvertisement = (adv = {}) => ({
  category: adv.categorie || "",
  promotion: adv?.promo?.active
    ? `${adv?.promo?.product || adv?.promo?.visibility || "paid"}`.toLowerCase()
    : "free",
  images: Array.isArray(adv.picsAudit)
    ? adv.picsAudit.length
    : (Array.isArray(adv.pics) ? adv.pics.length : 0),
  city: adv.city || "",
});

const uploadAdv = async (adv, jHeader) => {
  const clonedAdv = JSON.parse(JSON.stringify(adv)); // Deep clone
  const clonedHeader = { ...jHeader }; // Shallow clone if `jHeader` is flat
  console.log("[bakecaincontrii] Starting upload", summarizeAdvertisement(clonedAdv));

  try {
    logger.debug("Starting adv upload");
    const firstResponse = await firstStep(clonedAdv, clonedHeader);
    if (!firstResponse) {
      throw createWorkflowError(
        "BAKECAINCONTRII_FIRST_STEP_FAILED",
        "first-step",
        "Bakecaincontrii ha rifiutato i dati iniziali dell'annuncio."
      );
    }

    const secondResponse = await secondStep(
      clonedAdv.picsAudit,
      firstResponse,
      clonedHeader,
      clonedAdv
    );
    if (!secondResponse) {
      throw createWorkflowError(
        "BAKECAINCONTRII_IMAGES_STEP_FAILED",
        "images-step",
        "Bakecaincontrii non ha confermato il caricamento delle immagini."
      );
    }

    const thirdResponse = await thirdStep(clonedAdv, secondResponse.url, clonedHeader);
    if (!thirdResponse?.uri) {
      throw createWorkflowError(
        "BAKECAINCONTRII_PROMOTION_STEP_FAILED",
        "promotion-step",
        "Bakecaincontrii non ha restituito la pagina di pubblicazione o promozione."
      );
    }
    return {
      ...thirdResponse,
      imageWarnings: secondResponse.imageWarnings || [],
      uploadedImages: secondResponse.uploadedImages || 0,
      requestedImages: secondResponse.requestedImages || 0,
      imagesComplete: secondResponse.imagesComplete !== false,
    };
  } catch (error) {
    logger.error(error);
    throw error;
  }
};

const createWorkflowError = (code, stage, message, details = {}) => {
  const error = new Error(message);
  error.code = code;
  error.stage = stage;
  error.details = details;
  return error;
};

const isInvalidImageContentError = (error) => {
  if (error?.code !== "BAKECAINCONTRII_IMAGE_UPLOAD_REJECTED") return false;
  const responseBody = error?.details?.responseBody;
  try {
    const parsed = typeof responseBody === "string"
      ? JSON.parse(responseBody)
      : responseBody;
    return `${parsed?.error_code || ""}` === "2";
  } catch (parseError) {
    return /image with invalid content/i.test(`${responseBody || ""}`);
  }
};

const createImageUploadForm = (image, temporaryCode) => {
  const formData = new FormData();
  const filename = path.basename(image);
  formData.append("pictureFiles", fs.createReadStream(image), {
    filename,
    contentType: "image/jpeg",
    knownLength: fs.statSync(image).size,
  });
  formData.append("privateCode", "");
  formData.append("temporaryCode", temporaryCode);
  return formData;
};

const requestImageUpload = async (image, temporaryCode, i, jHeader) => {
  let lastFailure = null;

  for (let attempt = 1; attempt <= IMAGE_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    // FormData contains a one-shot file stream, so it must be rebuilt for every
    // retry. Reusing it causes later attempts to send an empty image body.
    const formData = createImageUploadForm(image, temporaryCode);
    try {
      const response = await axios({
        url: `${BASE_URL}/u/upload-image/`,
        headers: {
          authority: "bari.bakecaincontrii.com",
          accept: "application/json, text/plain, */*",
          "accept-language": "it",
          "cache-control": "no-cache",
          cookie: getCookie(jHeader),
          origin: BASE_URL,
          pragma: "no-cache",
          referer: `${BASE_URL}/u/post-insert-images/${temporaryCode}/`,
          "upgrade-insecure-requests": "1",
          "x-csrftoken": jHeader.csrftoken,
          "x-requested-with": "XMLHttpRequest",
          ...formData.getHeaders(),
        },
        data: formData,
        method: "POST",
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 60000,
        validateStatus: () => true,
      });

      const responseUrl = response?.request?.res?.responseUrl || "";
      const status = Number(response?.status || 0);
      const candidates = collectPictureCandidates(response?.data);

      // Some duplicate-image responses use a non-2xx status but still return
      // reusable picture metadata. Preserve that valid server-provided object.
      if (candidates.length > 0) {
        if (status < 200 || status >= 300) {
          logger.warn(
            `Image ${i} returned HTTP ${status} with reusable picture metadata`
          );
        }
        return response.data;
      }

      if (responseUrl.includes("/u/login")) {
        throw createWorkflowError(
          "BAKECAINCONTRII_IMAGE_SESSION_EXPIRED",
          "images-step",
          `Sessione Bakecaincontrii scaduta durante il caricamento dell'immagine ${i + 1}.`,
          { imageIndex: i, status, responseUrl }
        );
      }

      if (status >= 200 && status < 300) {
        throw createWorkflowError(
          "BAKECAINCONTRII_IMAGE_RESPONSE_INVALID",
          "images-step",
          `Bakecaincontrii ha risposto senza dati immagine utilizzabili per il file ${i + 1}.`,
          {
            imageIndex: i,
            attempt,
            status,
            responseUrl,
            responseBody: responseBodySnippet(response?.data),
          }
        );
      }

      lastFailure = {
        imageIndex: i,
        attempt,
        status,
        statusText: response?.statusText || "",
        responseUrl,
        responseBody: responseBodySnippet(response?.data),
      };

      const retryable = [408, 425, 429].includes(status) || status >= 500;
      if (!retryable) {
        throw createWorkflowError(
          "BAKECAINCONTRII_IMAGE_UPLOAD_REJECTED",
          "images-step",
          `Bakecaincontrii ha rifiutato l'immagine ${i + 1} con HTTP ${status || "sconosciuto"}.`,
          lastFailure
        );
      }
    } catch (error) {
      if (error?.code?.startsWith("BAKECAINCONTRII_")) throw error;
      lastFailure = {
        imageIndex: i,
        attempt,
        status: error?.response?.status || 0,
        statusText: error?.response?.statusText || "",
        responseUrl: error?.response?.request?.res?.responseUrl || "",
        responseBody: responseBodySnippet(error?.response?.data),
        networkError: error?.message || `${error}`,
      };
    }

    if (attempt < IMAGE_UPLOAD_MAX_ATTEMPTS) {
      const retryDelay = IMAGE_UPLOAD_DELAY_MS * attempt;
      logger.warn(
        `Image ${i} upload attempt ${attempt} failed; retrying in ${retryDelay} ms`
      );
      await delay(retryDelay);
    }
  }

  throw createWorkflowError(
    "BAKECAINCONTRII_IMAGE_UPLOAD_REQUEST_FAILED",
    "images-step",
    `Caricamento dell'immagine ${i + 1} fallito dopo ${IMAGE_UPLOAD_MAX_ATTEMPTS} tentativi.`,
    lastFailure || { imageIndex: i }
  );
};

const firstStep = async (adv, jHeader) => {
  logger.debug("Initialized first-step on Bakeca (adv data)");
  //Getting firstStep csrf for post request
  const csrfmiddlewaretoken = await extract_csrf({
    url: `${BASE_URL}/u/post-insert/`,
    headers: pageGetHeader(getCookie(jHeader)),
  });
  if (!csrfmiddlewaretoken) {
    logger.error("Failed getting csrftoken!");
    return undefined;
  }
  logger.debug("csrftoken obtained successfully!");
  const REQ_RESPONSE = await fetchWithRetry({
    url: `${BASE_URL}/u/post-insert/`,
    method: "POST",
    headers: firstPostHeader(getCookie(jHeader), BASE_URL),
    body: firstStepBody(adv, csrfmiddlewaretoken, jHeader.logged_cookie),
  });


  
  if (!REQ_RESPONSE) {
    logger.error("Error during the POST request");
    return undefined;
  }
  logger.success("Completed first-step successfully");
  return REQ_RESPONSE.url;
};

const secondStep = async (picsAudit, url, jHeader, adv) => {
  logger.debug("Initialized seconds-step on Bakeca(image upload)");
  const TEMP_CODE = url.replace(/\/$/, "").split("/").pop();

  //Getting secondStep csrf for post request
  const csrfmiddlewaretoken = await extract_csrf({
    url,
    headers: pageGetHeader(getCookie(jHeader)),
  });
  if (!csrfmiddlewaretoken) {
    logger.error("Failed getting csrftoken!");
    return undefined;
  }
  logger.debug("csrftoken obtained successfully!");

  const IMAGE_STORE = [];
  const formattedPics = await extract_images({
    picsAudit,
    adv,
    normalizeForBakecaincontrii: true,
  });
  logger.debug(`Prepared ${formattedPics.length} image(s) for Bakecaincontrii upload`);
  const acceptedPicsAudit = [];
  const imageWarnings = [];
  const extraTemporaryImages = [];

  // Bakecaincontrii associates uploads with one temporary code. Send them in
  // sequence so concurrent requests cannot overwrite the temporary gallery.
  for (let i = 0; i < formattedPics.length; i += 1) {
    const usedPictureUuids = new Set(IMAGE_STORE.map((picture) => picture.uuid));
    const uploadResult = await uploadImage(
      formattedPics[i],
      TEMP_CODE,
      i,
      jHeader,
      usedPictureUuids,
      picsAudit?.[i]?.path
    );
    if (uploadResult.temporaryImage) {
      extraTemporaryImages.push(uploadResult.temporaryImage);
    }
    if (uploadResult.picture) {
      IMAGE_STORE.push(uploadResult.picture);
      acceptedPicsAudit.push(picsAudit?.[i] || {});
    }
    if (uploadResult.warning) {
      imageWarnings.push(uploadResult.warning);
    }
    if (i < formattedPics.length - 1 && IMAGE_UPLOAD_DELAY_MS > 0) {
      await delay(IMAGE_UPLOAD_DELAY_MS);
    }
  }

  if (IMAGE_STORE.length === 0) {
    throw createWorkflowError(
      "BAKECAINCONTRII_IMAGE_UPLOAD_INCOMPLETE",
      "images-step",
      "Bakecaincontrii ha rifiutato tutte le immagini selezionate.",
      {
        requested: formattedPics.length,
        uploaded: 0,
        imageWarnings,
      }
    );
  }

  const canContinueWithAcceptedImages = canContinueWithRejectedImages({
    requested: formattedPics.length,
    uploaded: IMAGE_STORE.length,
    warnings: imageWarnings,
  });
  if ((imageWarnings.length || IMAGE_STORE.length !== formattedPics.length) && !canContinueWithAcceptedImages) {
    throw createWorkflowError(
      "BAKECAINCONTRII_IMAGE_UPLOAD_INCOMPLETE",
      "images-step",
      `Bakecaincontrii ha accettato ${IMAGE_STORE.length} immagini su ${formattedPics.length}; pubblicazione interrotta per evitare un annuncio senza tutte le foto.`,
      {
        requested: formattedPics.length,
        uploaded: IMAGE_STORE.length,
        imageWarnings,
      }
    );
  }
  if (canContinueWithAcceptedImages) {
    console.warn("[bakecaincontrii:images] Continuing with accepted images after remote content rejection", {
      requested: formattedPics.length,
      uploaded: IMAGE_STORE.length,
      skipped: imageWarnings.map((warning) => ({
        position: Number.isInteger(warning.imageIndex) ? warning.imageIndex + 1 : null,
        sourcePath: warning.sourcePath || "",
      })),
    });
  } else {
    logger.debug(`All ${IMAGE_STORE.length} image(s) uploaded; saving the gallery`);
  }

  const REQ_RESPONSE = await fetchWithRetry({
    url: `${BASE_URL}/u/post-insert-images/${TEMP_CODE}/`,
    method: "POST",
    headers: secondPostHeader(getCookie(jHeader), BASE_URL, TEMP_CODE),
    body: secondStepBody(
      IMAGE_STORE,
      csrfmiddlewaretoken,
      TEMP_CODE,
      acceptedPicsAudit
    ),
  });
  const sourcePaths = new Set(
    (Array.isArray(picsAudit) ? picsAudit : [])
      .map((picture) => picture?.path)
      .filter(Boolean)
  );
  unlinkImages([
    ...formattedPics.filter((filePath) => !sourcePaths.has(filePath)),
    ...extraTemporaryImages,
  ]);
  if (!REQ_RESPONSE) {
    logger.error("Error during the POST request");
    return undefined;
  }

  const galleryUrl = `${REQ_RESPONSE.url || ""}`;
  if (!galleryUrl || /\/u\/post-insert-images\//i.test(galleryUrl)) {
    const responseBody = await REQ_RESPONSE.clone().text().catch(() => "");
    throw createWorkflowError(
      "BAKECAINCONTRII_GALLERY_NOT_CONFIRMED",
      "images-step",
      "Bakecaincontrii non ha confermato il salvataggio della galleria.",
      {
        requested: formattedPics.length,
        uploaded: IMAGE_STORE.length,
        responseUrl: galleryUrl,
        responseBody: responseBodySnippet(responseBody),
      }
    );
  }

  console.log("[bakecaincontrii:images] Gallery saved", {
    requested: formattedPics.length,
    uploaded: IMAGE_STORE.length,
    nextUrl: galleryUrl,
  });
  logger.success("Completed second-step successfully");
  return {
    url: galleryUrl,
    imageWarnings,
    uploadedImages: IMAGE_STORE.length,
    requestedImages: formattedPics.length,
    imagesComplete: imageWarnings.length === 0 && IMAGE_STORE.length === formattedPics.length,
  };
};

const thirdStep = async (adv, url, jHeader) => {
  try {
    logger.debug("Initialized third-step on Bakeca (promo selection)");

    console.log("[bakecaincontrii:promotion] Starting", {
      ...summarizeAdvertisement(adv),
      url,
    });

    let TEMP_CODE = url.replace(/\/$/, "").split("/").pop();
    console.log("TEMP_CODE:", TEMP_CODE);

    // Extract CSRF token and private code
    const [private_code, csrfmiddlewaretoken] = await extract_params({
      url,
      headers: pageGetHeader(getCookie(jHeader)),
      params: ["private_code", "csrfmiddlewaretoken"],
    });

    let reqUrl = "";

    if (adv.promo.active) {
      reqUrl = `${BASE_URL}/u/post-promote/${private_code}/`;
    } else {
      reqUrl = `${BASE_URL}/u/post-publish/${private_code}`;
    }

    const requestedProduct = `${adv.promo.product || adv.promo.visibility || ""}`.trim().toLowerCase();
    if (adv.promo.active && ["flash", "star"].includes(requestedProduct)) {
      logger.debug(`${requestedProduct} selected; handing the live promotion page to the browser workflow`);
      return {
        uri: reqUrl,
        promo: true,
        promotionType: requestedProduct,
        remotePostId: "",
      };
    }

    const requestBody = thirdStepBody(
      adv.promo,
      csrfmiddlewaretoken,
      private_code,  // 👈 use private_code here now
      private_code
    );

    const REQ_RESPONSE = await fetchWithRetry({
      url: reqUrl,
      method: "POST",
      headers: thirdPostHeader(getCookie(jHeader), BASE_URL, private_code), // 👈 also here
      body: requestBody,
    });

    if (!REQ_RESPONSE) {
      logger.error("❌ Error during the POST request (REQ_RESPONSE is null)");
      return undefined;
    }

    console.log("[bakecaincontrii:promotion] Selection response", {
      status: REQ_RESPONSE.status,
      url: REQ_RESPONSE.url,
    });

    logger.debug("✅ Selected the promo successfully");

    let RESP_URI = "";
    let remotePostId = "";

    if (adv.promo.active) {
      const checkoutUrl = `${BASE_URL}/u/post-promote/${private_code}/`;
      console.log("➡️ Requesting checkout page...");
      console.log("Checkout URL:", checkoutUrl);

      try {
        const headers = thirdPostHeader(getCookie(jHeader), BASE_URL, private_code);
        const CHECKOUT_RESPONSE = await fetchWithRetry({
          url: checkoutUrl,
          headers: headers,
        });
        if (!CHECKOUT_RESPONSE) {
          
          logger.warn("⚠️ CHECKOUT_RESPONSE is null, falling back to URL");
          logger.warn("Phone number is probably blocked");
          RESP_URI = null;
          //remotePostId = "bari.bakecaincontrii.com"; // Fallback value
        } else {
          RESP_URI = CHECKOUT_RESPONSE.url;
          console.log("[bakecaincontrii:promotion] Checkout page ready", {
            status: CHECKOUT_RESPONSE.status,
            url: RESP_URI,
          });
          logger.success("✅ Retrieved the checkout page");
        }
      } catch (err) {
        console.error("❌ Error fetching checkout page:", err);
        RESP_URI = `${BASE_URL}/u/post-promote/${private_code}/`; // fallback
      }
    } else {
      RESP_URI = REQ_RESPONSE.url;
      remotePostId = REQ_RESPONSE.url.replace(/\/$/, "").split("/").pop();
      console.log("remotePostId:", remotePostId);
    }

    return {
      uri: RESP_URI,
      promo: adv.promo.active,
      promotionType: requestedProduct || (adv.promo.active ? "top" : "free"),
      remotePostId,
    };

  } catch (error) {
    console.error("❌ Error in thirdStep function:", error);
    logger.error("Exception caught in thirdStep:", error);
    return undefined;
  }
};

const uploadImage = async (
  image,
  temporaryCode,
  i,
  jHeader,
  usedPictureUuids = new Set(),
  sourcePath = ""
) => {
  logger.debug(`Starting image ${i} upload`);
  if (!image || !fs.existsSync(image)) {
    throw createWorkflowError(
      "BAKECAINCONTRII_IMAGE_FILE_MISSING",
      "images-step",
      `Il file immagine ${i + 1} non esiste: ${image || "<vuoto>"}.`
    );
  }

  let uploadPath = image;
  let temporaryImage = null;
  let IMG_RESPONSE;

  try {
    IMG_RESPONSE = await requestImageUpload(uploadPath, temporaryCode, i, jHeader);
  } catch (error) {
    if (!isInvalidImageContentError(error)) throw error;

    logger.warn(
      `Image ${i + 1} was rejected as invalid content; retrying with the strict JPEG profile.`
    );
    temporaryImage = await prepareUploadImage(image, { compatibilityMode: true });
    uploadPath = temporaryImage;

    try {
      IMG_RESPONSE = await requestImageUpload(uploadPath, temporaryCode, i, jHeader);
    } catch (fallbackError) {
      if (!isInvalidImageContentError(fallbackError)) throw fallbackError;

      const warning = {
        code: "BAKECAINCONTRII_IMAGE_SKIPPED_INVALID_CONTENT",
        imageIndex: i,
        sourcePath: sourcePath || image,
        reason: "Bakecaincontrii ha rifiutato l'immagine anche dopo la rasterizzazione JPEG su tela compatibile; probabile rifiuto del contenuto remoto.",
        responseBody: fallbackError?.details?.responseBody || "",
      };
      logger.warn(`Skipping rejected image ${i + 1}: ${warning.sourcePath}`);
      return { picture: null, warning, temporaryImage };
    }
  }

  const candidates = collectPictureCandidates(IMG_RESPONSE);
  const picture = candidates.find((candidate) => !usedPictureUuids.has(candidate.uuid));

  if (!picture) {
    throw createWorkflowError(
      "BAKECAINCONTRII_IMAGE_RESPONSE_INVALID",
      "images-step",
      `Bakecaincontrii non ha restituito un'immagine utilizzabile e distinta per il file ${i + 1}.`,
      { imageIndex: i, ...summarizeImageResponse(IMG_RESPONSE, candidates) }
    );
  }

  logger.debug(
    `Upload for image ${i} completed (uuid=${picture.uuid}, candidates=${candidates.length})`
  );
  return { picture, warning: null, temporaryImage };
};

module.exports = uploadAdv;
