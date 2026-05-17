const {
  suspendPostHeader,
  suspendPostBody,
} = require("../../helpers/dataComposer");
var fs = require("fs");
const { Signale } = require("signale");
const { default: axios } = require("axios");

const options = {
  types: {
    debug: {
      color: "grey",
    },
  },
};
const logger = new Signale(options);
const BASE_URL = "https://bakeca.it";

const getCookie = (jHeader) => {
  var cookie = "";
  for (var key in jHeader) {
    cookie += `${key}=${jHeader[key]};`;
  }
  return cookie;
};

const suspendAdv = async (private_code, jHeader) => {
  return new Promise(async (resolve, reject) => {
    try {
      logger.debug("Starting adv suspend");
      const firstResponse = await firstStep(private_code, jHeader);
      if (firstResponse) {
        logger.success("Adv suspended succesfully");
        resolve(firstResponse);
      }
      reject("ERROR");
    } catch (e) {
      logger.error(e);
      reject(e);
    }
  });
};

const firstStep = async (private_code, jHeader) => {
  //Getting firstStep csrf for post request
  logger.debug("Sending suspend POST REQ");
  const REQ_RESPONSE = await axios({
    url: `${BASE_URL}/u/suspend-post/`,
    method: "POST",
    headers: suspendPostHeader(getCookie(jHeader), BASE_URL, jHeader),
    data: suspendPostBody(private_code),
  });

  if (REQ_RESPONSE.status !== 204) {
    logger.error("Error during the POST request");
    return undefined;
  }
  logger.success("Completed first-step successfully");
  return "OK";
};

module.exports = suspendAdv;
