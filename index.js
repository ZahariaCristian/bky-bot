const express = require("express");
const bodyParser = require("body-parser");
const uploadAdv = require("./actions/bakecaincontrii/postUpload");
const suspendAdv = require("./actions/bakecaincontrii/postSuspend");
const editAdv = require("./actions/bakecaincontrii/postEdit");

const { imageProcessor } = require("./imageProcessor");
const { extractEmail } = require("./helpers/common");
//const { userBlockedAlert } = require("./telegram");
require("dotenv").config();
//require("./telegram");

const app = express();
const port = 9999;

// parse application/json
app.use(bodyParser.json());

const summarizeAdvertisement = (adv = {}, operation = "publish") => ({
  operation,
  category: adv.categorie || "",
  promotion: adv?.promo?.active
    ? `${adv?.promo?.product || adv?.promo?.visibility || "paid"}`.toLowerCase()
    : "free",
  images: Array.isArray(adv.picsAudit)
    ? adv.picsAudit.length
    : (Array.isArray(adv.pics) ? adv.pics.length : 0),
  city: adv.city || "",
});

app.post("/", async (req, res) => {
  const { adv, cookies, expectedEmail } = req.body;
  console.log("[bakecaincontrii] Request received", summarizeAdvertisement(adv));
  if (!adv) {
    console.log("MISSING ADV");
    return res.send("MISSING ADV");
  }

  if (!cookies) {
    console.log("MISSING COOKIES");
    return res.send("MISSING COOKIES");
  }

  if (expectedEmail) {
    const cookieEmail = extractEmail(cookies.logged_cookie || "");
    if (cookieEmail && cookieEmail.toLowerCase() !== expectedEmail.toLowerCase()) {
      return res.status(409).send("COOKIE_USER_MISMATCH");
    }
  }

  try {
    return res.json(await uploadAdv(adv, cookies));
  } catch (error) {
    const payload = {
      ok: false,
      code: error?.code || "BAKECAINCONTRII_UPLOAD_FAILED",
      stage: error?.stage || "unknown",
      message: error?.message || `${error || "Errore sconosciuto"}`,
      details: error?.details || {},
    };
    console.error("Bakecaincontrii upload failed", payload);
    return res.status(502).json(payload);
  }
});

app.post("/edit-adv", async (req, res) => {
  const { adv, cookies, remotePostID, expectedEmail } = req.body;
  console.log("[bakecaincontrii] Request received", {
    ...summarizeAdvertisement(adv, "edit"),
    remotePostID: remotePostID || "",
  });

  if (!adv) {
    console.log("MISSING ADV");
    return res.send("MISSING ADV");
  }

  if (!remotePostID) {
    console.log("MISSING REMOTEPOSTID");
    return res.send("MISSING REMOTEPOSTID");
  }

  if (!cookies) {
    console.log("MISSING COOKIES");
    return res.send("MISSING COOKIES");
  }
  if (expectedEmail) {
    const cookieEmail = extractEmail(cookies.logged_cookie || "");
    if (cookieEmail && cookieEmail.toLowerCase() !== expectedEmail.toLowerCase()) {
      return res.status(409).send("COOKIE_USER_MISMATCH");
    }
  }
  try {
    return res.send(await editAdv(adv, cookies, remotePostID));
  } catch (error) {
    const payload = {
      ok: false,
      code: error?.code || "BAKECAINCONTRII_EDIT_FAILED",
      stage: error?.stage || "edit-images-step",
      message: error?.message || `${error || "Errore sconosciuto"}`,
      details: error?.details || {},
    };
    console.error("Bakecaincontrii edit failed", payload);
    return res.status(502).json(payload);
  }
});

app.post("/suspend-adv", async (req, res) => {
  const { private_code, cookies } = req.body;

  if (!private_code) {
    res.send("MISSING private_code");
  }

  if (!cookies) {
    res.send("MISSING COOKIES");
  }
  res.send(
    await suspendAdv(private_code, cookies)
      .then((data) => data)
      .catch((e) => e)
  );
});

app.post("/edit-image", async (req, res) => {
  const { imagePath, adv } = req.body;
  console.log(req.body)
  res.send(await imageProcessor(imagePath, adv));
});

app.post("/user-blocked", async (req, res) => {
  const { userName, country } = req.body;
  //await userBlockedAlert(userName, country)
  res.send("OK");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
