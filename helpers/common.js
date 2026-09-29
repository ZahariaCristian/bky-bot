const { default: axios } = require("axios");
const cheerio = require("cheerio");
const signale = require("signale");
const { imageProcessor } = require("../imageProcessor");

function toSnippet(value, maxLength = 500) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value.slice(0, maxLength);
  }
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch (err) {
    return String(value).slice(0, maxLength);
  }
}

function parseJsonIfPossible(text) {
  if (!text || typeof text !== "string") {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function normalizeHeaders(headers) {
  if (!headers) {
    return {};
  }
  if (typeof headers.entries === "function") {
    return Object.fromEntries(headers.entries());
  }
  return headers;
}

function formatResponseDetails(details) {
  if (!details) {
    return "";
  }
  const status = details.status ?? "unknown";
  const statusText = details.statusText || "";
  const url = details.url || "unknown";
  const contentType = details.contentType || "unknown";
  return (
    `status=${status} ${statusText}`.trim() +
    ` | url=${url} | content-type=${contentType}`
  );
}

async function fetchWithRetry({
  url,
  headers,
  method = "GET",
  body = null,
  maxRetries = 3,
  retryDelay = 1000,
  useAxios = false,
  errorCallback,
}) {
  let retryCount = 0;
  let lastError = null;
  let lastResponseDetails = null;

  while (retryCount < maxRetries) {
    try {
      if (!useAxios) {
        const response = await fetch(url, {
          headers: headers,
          body: body,
          method: method,
        });
        if (response.url.includes("/u/login")) {
          signale.error("Session expired");
          throw new Error("Session expired");
        }
        if (response.ok) {
          // Request was successful, return the response
          return response;
        }

        const responseText = await response
          .clone()
          .text()
          .catch(() => "");
        lastResponseDetails = {
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          contentType: response.headers.get("content-type") || "",
          headers: normalizeHeaders(response.headers),
          json: parseJsonIfPossible(responseText),
          body: toSnippet(responseText),
        };
        const responseError = new Error(`HTTP ${response.status} ${response.statusText}`);
        if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
          lastError = responseError;
          break;
        }
        throw responseError;
      } else {
        const response = await axios({
          url,
          headers,
          data: body,
          method,
          validateStatus: () => true,
        });

        const responseUrl = response?.request?.res?.responseUrl || url;
        if (responseUrl.includes("/u/login")) {
          signale.error("Session expired");
          throw new Error("Session expired");
        }

        if (response?.status === 200 || response?.status === 201) {
          return response.data;
        }

        lastResponseDetails = {
          status: response?.status,
          statusText: response?.statusText,
          url: responseUrl,
          contentType: response?.headers?.["content-type"] || "",
          headers: normalizeHeaders(response?.headers),
          json:
            typeof response?.data === "object"
              ? response?.data
              : parseJsonIfPossible(response?.data),
          body: toSnippet(response?.data),
        };
        const responseError = new Error(
          `HTTP ${response?.status || "unknown"} ${response?.statusText || ""}`.trim()
        );
        if (response?.status >= 400 && response?.status < 500 && ![408, 429].includes(response.status)) {
          lastError = responseError;
          break;
        }
        throw responseError;
      }
    } catch (error) {
      lastError = error;
      if (error?.response) {
        const responseUrl = error?.response?.request?.res?.responseUrl || url;
        lastResponseDetails = {
          status: error?.response?.status,
          statusText: error?.response?.statusText,
          url: responseUrl,
          contentType: error?.response?.headers?.["content-type"] || "",
          headers: normalizeHeaders(error?.response?.headers),
          json:
            typeof error?.response?.data === "object"
              ? error?.response?.data
              : parseJsonIfPossible(error?.response?.data),
          body: toSnippet(error?.response?.data),
        };
      }
      // An error occurred (e.g., a timeout)
      signale.debug(`Attempt ${retryCount + 1} failed: ${error.message}`);
    }

    retryCount++;
    if (retryCount < maxRetries) {
      signale.debug(`Retrying in ${retryDelay / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
  if (errorCallback) {
    errorCallback();
  }
  signale.error(`Request failed after ${maxRetries} attempts.`);
  if (lastResponseDetails) {
    signale.error(
      `Last response details: ${formatResponseDetails(lastResponseDetails)}`
    );
    if (Object.keys(lastResponseDetails.headers || {}).length) {
      signale.error(
        `Last response headers: ${toSnippet(lastResponseDetails.headers, 1000)}`
      );
    }
    if (lastResponseDetails.json !== null && lastResponseDetails.json !== undefined) {
      signale.error(
        `Last response json: ${toSnippet(lastResponseDetails.json, 2000)}`
      );
    } else if (lastResponseDetails.body) {
      signale.error(`Last response body: ${lastResponseDetails.body}`);
    } else {
      signale.error("Last response body: <empty>");
    }
  }
  if (lastError) {
    signale.error(`Last error message: ${lastError.message}`);
  }
  return null;
}

async function extract_csrf({ url, headers }) {
  const PAGE = await fetchWithRetry({
    url,
    method: "GET",
    headers,
  });
  if (!PAGE) {
    signale.error(`Missing page = ${url} for csrf extractor`);
    return undefined;
  }

  const $ = cheerio.load(await PAGE.text());
  const csrfmiddlewaretoken = $('input[name="csrfmiddlewaretoken"]').attr(
    "value"
  );
  if (!csrfmiddlewaretoken) {
    return undefined;
  }

  return csrfmiddlewaretoken;
}

const mappedParams = {
  csrfmiddlewaretoken: "csrf-token",
  private_code: "private-code",
}

async function extract_params({ url, headers, params }) {
  const PAGE = await fetchWithRetry({
    url,
    method: "GET",
    headers,
  });
  if (!PAGE) {
    signale.error(`Missing page = ${url} for csrf extractor`);
    return undefined;
  }

  const $ = cheerio.load(await PAGE.text());

  // Find the meta tag with property="og:url"
  const metaTag = $('meta[property="og:url"]');

  // Get the value of the content attribute
  const ogUrl = metaTag.attr("content");

  console.log(ogUrl);

  const results = params?.map((p) => {
    let val = $(`input[name="${p}"]`).attr("value");
    if(!val) {
      val = $('post-promote-manager').attr(mappedParams[p]);
    }
    return val;
  });
  return results;
}

function extractEmail(text) {
  const regex = /"([^\",\\]+@[^\",\\]+)"|([^\",\\]+@[^\",\\]+)/;
  const match = text.match(regex);

  if (match) {
    const email = (match[1] || match[2]).replace(/\\/g, "").replace(/,/g, "");
    return email;
  }

  return null; // Return null if no email is found
}

async function extract_images({ picsAudit, adv }) {
  console.log("picsaudit log and adv: ")
  console.log(picsAudit)
  console.log(adv)
  if (picsAudit) {
    try {
      let picsWaiter = [];
      picsAudit.forEach((pa) => {
        if (pa.applyPhone) {
          console.log("pa log: " + pa)
          console.log("pa.path log: " + pa.path)
          picsWaiter.push(imageProcessor([pa.path], adv));
        } else {
          picsWaiter.push(pa.path);
        }
      });
      picsWaiter = await Promise.all(picsWaiter);
      return picsWaiter;
    } catch (e) {
      console.error(e);
      return [];
    }
  } else {
    return [];
  }
}

function formatCrop(crop) {
  if (!crop) {
    return null;
  }
  const parsedCrop = JSON.parse(crop);
  console.log("safecrop: " + parsedCrop)
  return {
    x: parsedCrop.x,
    y: parsedCrop.y,
    dx: parsedCrop.dx,
    dy: parsedCrop.dy,
  };
}

module.exports = {
  fetchWithRetry,
  extract_csrf,
  extract_params,
  extractEmail,
  extract_images,
  formatCrop,
};
