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

const options = {
  types: {
    debug: {
      color: "grey",
    },
  },
};
const logger = new Signale(options);
const BASE_URL = "https://bakeca.it";

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
  return new Promise(async (resolve, reject) => {
    try {
      logger.debug("Starting adv editing");
      const firstResponse = await firstStep(adv, jHeader, remotePostId);
      if (firstResponse) {
        advEditedAlert(adv, jHeader);
        logger.success("Adv edited succesfully");
        resolve(firstResponse);
      }
      reject("ERROR");
    } catch (e) {
      logger.error(e);
      reject(e);
    }
  });
};

const firstStep = async (adv, jHeader, remotePostId) => {
  setTimeout(async () => {
    const getUrl = `${BASE_URL}/u/post-update/${remotePostId}/?next=/u/post-manage/${remotePostId}/`;
    const reqUrl = `${BASE_URL}/u/post-update/${remotePostId}/`;
    logger.debug(reqUrl);
    //Getting firstStep csrf for post request
    logger.debug("Initialized first-step on Bakeca(edit)");
    const [csrfmiddlewaretoken] = await extract_params({
      url: getUrl,
      headers: editGetHeader(getCookie(jHeader)),
      params: ["csrfmiddlewaretoken"],
    });
    logger.debug("Grabbed all useful values and sending POST request");

    let IMAGE_STORE = [];
    let formattedPics = await extract_images({ picsAudit: adv.picsAudit, adv });
    formattedPics.forEach((image, i) => {
      IMAGE_STORE.push(uploadImage(image, remotePostId, i, jHeader, adv));
    });
    IMAGE_STORE = await Promise.all(IMAGE_STORE);
    logger.debug(`Images successfully submitted, starting the POST request`);

    const REQ_RESPONSE = await fetchWithRetry({
      url: reqUrl,
      method: "POST",
      headers: editPostHeader(getCookie(jHeader), BASE_URL, remotePostId),
      body: editPostBody(adv, csrfmiddlewaretoken, remotePostId, IMAGE_STORE),
    });
    unlinkImages(
      formattedPics.filter((fp) =>
        fp.includes("/home/bky_bot/images/")
      )
    );
    if (REQ_RESPONSE?.status !== 200) {
      logger.error("Error during the POST request");
      return undefined;
    }
    logger.success("Completed first-step successfully");
    return "OK";
  }, 2000);
};

const uploadImage = async (image, remotePostId, i, jHeader, adv) => {
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

  if (IMG_RESPONSE) {
    logger.debug(`Upload for image ${i} completed`);
    return IMG_RESPONSE.pictures[0];
  } else {
    logger.error(`Upload for image ${i} failed`);
    return;
  }
};

module.exports = editAdv;
