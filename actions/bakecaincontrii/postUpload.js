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
const FormData = require("form-data");
const { Signale } = require("signale");
const { unlinkImages } = require("../../imageProcessor");
const options = {
  types: {
    debug: {
      color: "grey",
    },
  },
};
const logger = new Signale(options);
const BASE_URL = "https://bari.bakecaincontrii.com";

const getCookie = (jHeader) => {
  var cookie = "";
  for (var key in jHeader) {
    cookie += `${key}=${jHeader[key]};`;
  }
  return cookie;
};

const uploadAdv = async (adv, jHeader) => {
  const clonedAdv = JSON.parse(JSON.stringify(adv)); // Deep clone
  const clonedHeader = { ...jHeader }; // Shallow clone if `jHeader` is flat
  console.log("Starting upload of", clonedAdv);

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

    const thirdResponse = await thirdStep(clonedAdv, secondResponse, clonedHeader);
    if (!thirdResponse?.uri) {
      throw createWorkflowError(
        "BAKECAINCONTRII_PROMOTION_STEP_FAILED",
        "promotion-step",
        "Bakecaincontrii non ha restituito la pagina di pubblicazione o promozione."
      );
    }
    return thirdResponse;
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
  const formattedPics = await extract_images({ picsAudit, adv });
  logger.debug(`Prepared ${formattedPics.length} image(s) for Bakecaincontrii upload`);

  // Bakecaincontrii associates uploads with one temporary code. Send them in
  // sequence so concurrent requests cannot overwrite the temporary gallery.
  for (let i = 0; i < formattedPics.length; i += 1) {
    const uploadedPicture = await uploadImage(
      formattedPics[i],
      TEMP_CODE,
      i,
      jHeader
    );
    IMAGE_STORE.push(uploadedPicture);
  }

  if (IMAGE_STORE.length !== formattedPics.length) {
    throw createWorkflowError(
      "BAKECAINCONTRII_IMAGE_UPLOAD_INCOMPLETE",
      "images-step",
      `Bakecaincontrii ha accettato ${IMAGE_STORE.length} immagini su ${formattedPics.length}.`,
      { requested: formattedPics.length, uploaded: IMAGE_STORE.length }
    );
  }

  logger.debug(`All ${IMAGE_STORE.length} image(s) uploaded; saving the gallery`);
  const REQ_RESPONSE = await fetchWithRetry({
    url: `${BASE_URL}/u/post-insert-images/${TEMP_CODE}/`,
    method: "POST",
    headers: secondPostHeader(getCookie(jHeader), BASE_URL, TEMP_CODE),
    body: secondStepBody(
      IMAGE_STORE,
      csrfmiddlewaretoken,
      TEMP_CODE,
      picsAudit
    ),
  });
  const sourcePaths = new Set(
    (Array.isArray(picsAudit) ? picsAudit : [])
      .map((picture) => picture?.path)
      .filter(Boolean)
  );
  unlinkImages(formattedPics.filter((filePath) => !sourcePaths.has(filePath)));
  if (!REQ_RESPONSE) {
    logger.error("Error during the POST request");
    return undefined;
  }
  logger.success("Completed second-step successfully");
  return REQ_RESPONSE.url;
};

const thirdStep = async (adv, url, jHeader) => {
  try {
    logger.debug("Initialized third-step on Bakeca (promo selection)");

    console.log("ADVLOG:", adv);
    console.log("URL:", url);
    console.log("jHeader:", jHeader);
    console.log("adv logs:", JSON.stringify(adv, null, 2));

    let TEMP_CODE = url.replace(/\/$/, "").split("/").pop();
    console.log("TEMP_CODE:", TEMP_CODE);

    // Extract CSRF token and private code
    const [private_code, csrfmiddlewaretoken] = await extract_params({
      url,
      headers: pageGetHeader(getCookie(jHeader)),
      params: ["private_code", "csrfmiddlewaretoken"],
    });

    console.log("private_code:", private_code);
    console.log("csrfmiddlewaretoken:", csrfmiddlewaretoken);

    let reqUrl = "";
    let useCode = private_code;

    if (adv.promo.active) {
      reqUrl = `${BASE_URL}/u/post-promote/${private_code}/`;
    } else {
      reqUrl = `${BASE_URL}/u/post-publish/${private_code}`;
    }

    console.log("Using code for requests:", useCode);
    console.log("reqUrl:", reqUrl);

    const requestedProduct = `${adv.promo.product || adv.promo.visibility || ""}`.trim().toLowerCase();
    if (adv.promo.active && requestedProduct === "flash") {
      logger.debug("Flash selected; handing the live promotion page to the browser workflow");
      return {
        uri: reqUrl,
        promo: true,
        promotionType: "flash",
        remotePostId: "",
      };
    }

    const requestBody = thirdStepBody(
      adv.promo,
      csrfmiddlewaretoken,
      private_code,  // 👈 use private_code here now
      private_code
    );

    console.log("Request Body:", JSON.stringify(requestBody, null, 2));

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

    console.log("REQ_RESPONSE:", REQ_RESPONSE);

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
        console.log("CHECKOUT_RESPONSE:", CHECKOUT_RESPONSE);
        if (!CHECKOUT_RESPONSE) {
          
          logger.warn("⚠️ CHECKOUT_RESPONSE is null, falling back to URL");
          logger.warn("Phone number is probably blocked");
          RESP_URI = null;
          //remotePostId = "bari.bakecaincontrii.com"; // Fallback value
          console.log("Using fallback URL:", RESP_URI);
        
        } else {
          const responseText = await CHECKOUT_RESPONSE.text();
          console.log("📝 Checkout Response Preview:", responseText.slice(0, 300));
          RESP_URI = CHECKOUT_RESPONSE.url;
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
      remotePostId,
    };

  } catch (error) {
    console.error("❌ Error in thirdStep function:", error);
    logger.error("Exception caught in thirdStep:", error);
    return undefined;
  }
};

const uploadImage = async (image, temporaryCode, i, jHeader) => {
  logger.debug(`Starting image ${i} upload`);
  if (!image || !fs.existsSync(image)) {
    throw createWorkflowError(
      "BAKECAINCONTRII_IMAGE_FILE_MISSING",
      "images-step",
      `Il file immagine ${i + 1} non esiste: ${image || "<vuoto>"}.`
    );
  }

  const formData = new FormData();
  const filename = image.replace(/\/$/, "").split("/").pop();
  formData.append("pictureFiles", fs.createReadStream(image), { filename });
  formData.append("privateCode", "");
  formData.append("temporaryCode", temporaryCode);

  const IMG_RESPONSE = await fetchWithRetry({
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
    body: formData,
    method: "POST",
    useAxios: true,
  });

  const responsePictures = Array.isArray(IMG_RESPONSE?.pictures)
    ? IMG_RESPONSE.pictures
    : [];
  const picture = responsePictures[0] || IMG_RESPONSE?.picture ||
    (IMG_RESPONSE?.uuid ? IMG_RESPONSE : null);
  const source = picture?.url || picture?.src;

  if (!picture?.uuid || !source) {
    throw createWorkflowError(
      "BAKECAINCONTRII_IMAGE_RESPONSE_INVALID",
      "images-step",
      `Bakecaincontrii non ha restituito i dati completi per l'immagine ${i + 1}.`,
      {
        imageIndex: i,
        responseKeys: IMG_RESPONSE && typeof IMG_RESPONSE === "object"
          ? Object.keys(IMG_RESPONSE)
          : []
      }
    );
  }

  const normalizedPicture = { ...picture, url: source, src: source };
  logger.debug(
    `Upload for image ${i} completed (uuid=${normalizedPicture.uuid})`
  );
  return normalizedPicture;
};

module.exports = uploadAdv;
