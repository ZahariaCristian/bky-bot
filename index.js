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

app.post("/", async (req, res) => {
  const { adv, cookies, expectedEmail } = req.body;
  console.log("UPLOADING", JSON.stringify(req.body))
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

  res.send(
    await uploadAdv(adv, cookies)
      .then((data) => data)
      .catch((e) => e)
  );
});

app.post("/edit-adv", async (req, res) => {
  const { adv, cookies, remotePostID, expectedEmail } = req.body;

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
  res.send(
    await editAdv(adv, cookies, remotePostID)
      .then((data) => data)
      .catch((e) => e)
  );
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
