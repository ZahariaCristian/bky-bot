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

  return new Promise(async (resolve, reject) => {
    try {
      logger.debug("Starting adv upload");
      const firstResponse = await firstStep(clonedAdv, clonedHeader);
      if (firstResponse) {
        const secondResponse = await secondStep(
          clonedAdv.picsAudit,
          firstResponse,
          clonedHeader,
          clonedAdv
        );
        if (secondResponse) {
          const thirdResponse = await thirdStep(
            clonedAdv,
            secondResponse,
            clonedHeader
          );
          if (thirdResponse) {
            resolve(thirdResponse);
          }
        }
      }
      reject("ERROR");
    } catch (e) {
      logger.error(e);
      reject(e);
    }
  });
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

  let IMAGE_STORE = [];
  let formattedPics = await extract_images({ picsAudit, adv }); // Ensure this is immutable
  const uploadTasks = formattedPics.map((image, i) => {
    return uploadImage(image, TEMP_CODE, i, jHeader, { ...adv }); // Pass a cloned `adv`
  });
  IMAGE_STORE = await Promise.all(uploadTasks); // Ensure independent uploads
  logger.debug(`Images successfully submitted, starting the POST request`);
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
  unlinkImages(
    formattedPics.filter((fp) =>
      fp.includes("/home/bky_bot/images/")
    )
  );
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

const uploadImage = async (image, temporaryCode, i, jHeader, adv) => {
  logger.debug(`Starting image ${i} upload`);
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
  }).catch((err) => {
    logger.error(`Error uploading image ${i}:`, err);
    //advImageError(adv, i, err);
    return undefined;
  });

  if (IMG_RESPONSE) {
    logger.debug(`Upload for image ${i} completed`);
    return IMG_RESPONSE.pictures[0];
  } else {
    logger.error(`Upload for image ${i} failed`);
    return;
  }
};

module.exports = uploadAdv;
