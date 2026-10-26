const {
  editPostBody,
  editPostHeader,
  editGetHeader,
} = require("../../helpers/dataComposer");
const {
  fetchWithRetry,
  extract_params,
  extract_images,
} = require("../../helpers/common");
var fs = require("fs");
const FormData = require("form-data");
const { Signale } = require("signale");
const { unlinkImages } = require("../../imageProcessor");
const { collectPictureCandidates, summarizeImageResponse } = require("./imageResponse");

const options = {
  types: {
    debug: {
      color: "grey",
    },
  },
};
const logger = new Signale(options);
const BASE_URL = "https://bari.bakecaincontrii.com";
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const createWorkflowError = (code, message, details = {}) => {
  const error = new Error(message);
  error.code = code;
  error.stage = "edit-images-step";
  error.details = details;
  return error;
};

function advImageError(adv, jHeader, image) {
    logger.error(`Image error for adv ${adv.id}, image: ${image}`);
}

const getCookie = (jHeader) => {
  var cookie = "";
  for (var key in jHeader) {
    cookie += `${key}=${jHeader[key]};`;
  }
  return cookie;
};

const editAdv = async (adv, jHeader, remotePostId) => {
  logger.debug("Starting adv editing");
  await delay(2000);
  const result = await firstStep(adv, jHeader, remotePostId);
  if (!result) {
    throw createWorkflowError(
      "BAKECAINCONTRII_EDIT_NOT_CONFIRMED",
      "Bakecaincontrii non ha confermato la modifica dell'annuncio.",
      { remotePostId }
    );
  }
  logger.success("Adv edited successfully");
  return result;
};

const firstStep = async (adv, jHeader, remotePostId) => {
  const getUrl = `${BASE_URL}/u/post-update/${remotePostId}/?next=/u/post-manage/${remotePostId}/`;
  const reqUrl = `${BASE_URL}/u/post-update/${remotePostId}/`;
  logger.debug("Initialized first-step on Bakeca(edit)");
  const [csrfmiddlewaretoken] = await extract_params({
    url: getUrl,
    headers: editGetHeader(getCookie(jHeader)),
    params: ["csrfmiddlewaretoken"],
  });
  if (!csrfmiddlewaretoken) {
    throw createWorkflowError(
      "BAKECAINCONTRII_EDIT_CSRF_MISSING",
      "Token CSRF non disponibile durante la modifica.",
      { remotePostId }
    );
  }

  const formattedPics = await extract_images({
    picsAudit: adv.picsAudit,
    adv,
    normalizeForBakecaincontrii: true,
  });
  const imageStore = [];
  for (let i = 0; i < formattedPics.length; i += 1) {
    const usedPictureUuids = new Set(imageStore.map((picture) => picture.uuid));
    imageStore.push(await uploadImage(
      formattedPics[i],
      remotePostId,
      i,
      jHeader,
      adv,
      usedPictureUuids
    ));
  }
  if (imageStore.length !== formattedPics.length) {
    throw createWorkflowError(
      "BAKECAINCONTRII_EDIT_IMAGE_UPLOAD_INCOMPLETE",
      `Bakecaincontrii ha accettato ${imageStore.length} immagini su ${formattedPics.length}.`,
      { requested: formattedPics.length, uploaded: imageStore.length, remotePostId }
    );
  }

  logger.debug(`All ${imageStore.length} edit image(s) uploaded; saving the advertisement`);
  const response = await fetchWithRetry({
    url: reqUrl,
    method: "POST",
    headers: editPostHeader(getCookie(jHeader), BASE_URL, remotePostId),
    body: editPostBody(adv, csrfmiddlewaretoken, remotePostId, imageStore),
  });
  unlinkImages(formattedPics);
  if (!response?.ok) {
    throw createWorkflowError(
      "BAKECAINCONTRII_EDIT_SAVE_FAILED",
      "Bakecaincontrii non ha salvato la modifica.",
      { remotePostId, status: response?.status || 0, responseUrl: response?.url || "" }
    );
  }
  if (/\/u\/post-update\//i.test(`${response.url || ""}`)) {
    const responseBody = await response.clone().text().catch(() => "");
    throw createWorkflowError(
      "BAKECAINCONTRII_EDIT_NOT_CONFIRMED",
      "Bakecaincontrii è rimasto nella pagina di modifica dopo il salvataggio.",
      { remotePostId, responseUrl: response.url, responseBody: responseBody.slice(0, 1000) }
    );
  }

  console.log("[bakecaincontrii:edit] Saved", {
    remotePostId,
    images: imageStore.length,
    responseUrl: response.url,
  });
  return "OK";
};

const uploadImage = async (image, remotePostId, i, jHeader, adv, usedPictureUuids) => {
  logger.debug(`Starting image ${i} upload`);
  const formData = new FormData();
  const filename = image.replace(/\/$/, "").split("/").pop();
  formData.append("pictureFiles", fs.createReadStream(image), { filename });
  formData.append("privateCode", remotePostId);
  formData.append("temporaryCode", "");

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
      referer: `${BASE_URL}/u/post-update/${remotePostId}/`,
      "upgrade-insecure-requests": "1",
      "x-csrftoken": jHeader.csrftoken,
      "x-requested-with": "XMLHttpRequest",
      ...formData.getHeaders(),
    },
    body: formData,
    method: "POST",
    useAxios: true,
    errorCallback: () => advImageError(adv, jHeader, image),
  });

  if (!IMG_RESPONSE) {
    throw createWorkflowError(
      "BAKECAINCONTRII_EDIT_IMAGE_UPLOAD_FAILED",
      `Caricamento dell'immagine ${i + 1} non riuscito.`,
      { imageIndex: i, sourcePath: image, remotePostId }
    );
  }

  const candidates = collectPictureCandidates(IMG_RESPONSE);
  const picture = candidates.find((candidate) => !usedPictureUuids.has(candidate.uuid));
  if (!picture) {
    throw createWorkflowError(
      "BAKECAINCONTRII_EDIT_IMAGE_RESPONSE_INVALID",
      `Bakecaincontrii non ha restituito dati utilizzabili per l'immagine ${i + 1}.`,
      { imageIndex: i, remotePostId, ...summarizeImageResponse(IMG_RESPONSE, candidates) }
    );
  }

  logger.debug(`Upload for image ${i} completed (uuid=${picture.uuid})`);
  return picture;
};

module.exports = editAdv;
