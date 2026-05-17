const categories = require("../constants/categories");
const cities = require("../constants/cities");
const promo = require("../constants/promo");
const tags = require("../constants/tags");
const { extractEmail, formatCrop } = require("./common");

//ADV INSERT
const tagParser = (adv) => {
  const multipleOptions = [
    "search_tag__services",
    "search_tag__attention_to",
    "search_tag__place_of_service",
    "search_tag__payment_methods",
  ];

  let activeTags = {};

  Object.keys(tags).forEach((t) => {
    if (adv[t] && adv[t] === true) {
      if (!multipleOptions.includes(Object.keys(tags[t])[0])) {
        activeTags = {
          ...activeTags,
          ...tags[t],
        };
      } else {
        //Multipli
        let tag = Object.keys(tags[t])[0];
        if (activeTags[tag]) {
          activeTags[tag] = [...activeTags[tag], tags[t][tag]];
        } else {
          activeTags[tag] = [tags[t][tag]];
        }
      }
    }
  });

  //Setting hourly price if present
  if (adv.hourlyPrice) {
    activeTags["hourly_price"] = adv.hourlyPrice;
  }

  //Mandatory Items
  if (!activeTags["search_tag__nationality"]) {
    activeTags["search_tag__nationality"] = "";
  }

  if (!activeTags["hourly_price"]) {
    activeTags["hourly_price"] = "";
  }

  var form_data = new FormData();

  //Slicing for limits
  if (activeTags["search_tag__services"]) {
    activeTags["search_tag__services"] = activeTags[
      "search_tag__services"
    ].slice(0, 8);
  }

  Object.keys(activeTags).forEach((t) => {
    if (multipleOptions.includes(t)) {
      activeTags[t].map((at) => {
        form_data.append(t, at);
      });
    } else {
      form_data.append(t, activeTags[t]);
    }
  });
  return form_data;
};

const firstStepBody = (adv, csrfmiddlewaretoken, email) => {
  const advBody = {
    csrfmiddlewaretoken,
    category: categories[adv.categorie],
    city: cities[adv.city],
    address: adv.location,
    postal_code: "",
    nickname: adv.nickname ? adv.nickname : "Anonimo",
    place: adv.location,
    age: adv.age,
    title: adv.title,
    description: adv.description,
    contact_method: 0,
    email: extractEmail(email),
    telephone: `+39 ${adv.phone.slice(0, 3)} ${adv.phone.slice(
      3,
      6
    )} ${adv.phone.slice(6, 10)}`,
    telephone_national: adv.phone,
    telephone_international: `+39${adv.phone}`,
    telephone_international_prefix: `+39${adv.phone}`,
    telephone_details: { contact: `+39${adv.phone}` },
    whatsapp: adv.whatsapp ? "1" : "0",
    telegram: adv.telegram ? "1" : "0",
    terms: "on",
  };

  var form_data = new FormData();

  for (var key in advBody) {
    form_data.append(key, advBody[key]);
  }
  const queryString = new URLSearchParams([
    ...form_data,
    ...tagParser(adv),
  ]).toString();
  return queryString;
};

const secondStepBody = (
  pictures,
  csrfmiddlewaretoken,
  temporary_code,
  picsAudit
) => {
  //adding crop values
  pictures = pictures.map((p, i) => ({
    ...p,
    crop: picsAudit[i]?.crop || null,
  }));

  console.log(picsAudit);

  const mappedImages = pictures
    .filter((p) => p?.uuid && p?.histogram && p?.fingerprint && p?.url)
    .map((p, i) => ({
      uuid: p.uuid,
      histogram: p.histogram,
      fingerprint: p.fingerprint,
      src: p.url,
      isCover: i === 0 ? true : false, //TODO Main image
      crop: formatCrop(p.crop),
      rotate: p.rotate || 0,
    }));

  console.log("starting mapping images cropdata")
  console.log(mappedImages)

  const body = {
    csrfmiddlewaretoken,
    temporary_code,
    images: JSON.stringify(mappedImages),
    photo_flag: "on",
    postImageRadios: "on",
  };

  var form_data = new FormData();

  for (var key in body) {
    form_data.append(key, body[key]);
  }
  const queryString = new URLSearchParams(form_data).toString();
  return queryString;
};

const thirdStepBody = (
  advpromo,
  csrfmiddlewaretoken,
  temporary_code,
  private_code
) => {
  //Getting promo option value
  let ctt_product_id = "";
  if (advpromo.active) {
    let optionKey = advpromo.visibility;
    if (advpromo.cam) {
      optionKey += "-cam";
    }
    if (advpromo.schedule && advpromo.schedule !== "") {
      ctt_product_id = promo[optionKey][advpromo.schedule];
    } else {
      ctt_product_id = promo[optionKey];
    }
  }

  let validAddons = Object.entries({
    premium: advpromo.premium,
    highlight: advpromo.highlight,
    etichetta: advpromo.etichetta
  })
  .filter(([_, value]) => value)
  .map(([key]) => key);

  if(validAddons.includes("premium") || validAddons.includes("etichetta")){
    //Replace premium with supertop
    validAddons = validAddons.map(addon => addon === "premium" ? "supertop" : addon === "etichetta" ? "new_label" : addon)
  }

  console.log({validAddons})

  const body = {
    csrfmiddlewaretoken,
    private_code,
    temporary_code,
    is_promote_after_insert: 1,
    ctt_product_id,
    premium_selected: 0,
    supertop_selected: advpromo.premium ? 1 : 0,
    use_coupon_addons: true,
    add_ons: validAddons.join(","),
    product_type: 'top',
  };

  var form_data = new FormData();

  for (var key in body) {
    form_data.append(key, body[key]);
  }

  const queryString = new URLSearchParams(form_data).toString();
  return queryString;
};

// HEADERS
const firstPostHeader = (cookie, baseURL) => ({
  authority: "bari.bakecaincontrii.com",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "it",
  "cache-control": "no-cache",
  "content-type": "application/x-www-form-urlencoded",
  cookie: cookie,
  origin: baseURL,
  pragma: "no-cache",
  referer: `${baseURL}/u/post-insert/`,
  "sec-ch-ua":
    '"Chromium";v="118", "Google Chrome";v="118", "Not=A?Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
});

const secondPostHeader = (cookie, baseURL, temporaryCode) => ({
  authority: "bari.bakecaincontrii.com",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "it",
  "cache-control": "no-cache",
  "content-type": "application/x-www-form-urlencoded",
  cookie: cookie,
  origin: baseURL,
  pragma: "no-cache",
  referer: `${baseURL}/u/post-insert-images/${temporaryCode}/`,
  "sec-ch-ua":
    '"Chromium";v="118", "Google Chrome";v="118", "Not=A?Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
});

const thirdPostHeader = (cookie, baseURL, temporaryCode) => ({
  authority: "bari.bakecaincontrii.com",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "it",
  "cache-control": "no-cache",
  "content-type": "application/x-www-form-urlencoded",
  cookie: cookie,
  origin: baseURL,
  pragma: "no-cache",
  referer: `${baseURL}/u/post-insert-images/${temporaryCode}/`,
  "sec-ch-ua":
    '"Chromium";v="118", "Google Chrome";v="118", "Not=A?Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
});

const pageGetHeader = (cookie) => ({
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "it",
  "cache-control": "no-cache",
  pragma: "no-cache",
  cookie: cookie,
});

//ADV SUSPEND
const suspendPostBody = (private_code) => {
  return {
    private_code,
  };
};

const suspendPostHeader = (cookie, baseURL, jHeader) => ({
  authority: "bari.bakecaincontrii.com",
  accept: "application/json, text/plain, */*",
  "accept-language": "it",
  "cache-control": "no-cache",
  "content-type": "application/json",
  cookie: cookie,
  origin: baseURL,
  pragma: "no-cache",
  referer: `${baseURL}/u/account/ads/`,
  "sec-ch-ua":
    '"Chromium";v="118", "Google Chrome";v="118", "Not=A?Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  "x-csrftoken": jHeader.csrftoken,
  "x-requested-with": "XMLHttpRequest",
});

//ADV EDIT
const editPostBody = (adv, csrfmiddlewaretoken, private_code, pictures) => {
  const mappedImages = pictures
    .filter((p) => p?.uuid && p?.histogram && p?.fingerprint && p?.url)
    .map((p, i) => ({
      uuid: p.uuid,
      histogram: p.histogram,
      fingerprint: p.fingerprint,
      src: p.url,
      isCover: i === 0 ? true : false, //TODO Main image
      crop: formatCrop(p.crop),
      rotate: p.rotate || 0,
    }));

  const advBody = {
    csrfmiddlewaretoken,
    private_code,
    next: `/u/post-manage/${private_code}/`,
    address: adv.location,
    postal_code: "",
    place: adv.location,
    age: adv.age,
    title: adv.title,
    nickname: adv.nickname ? adv.nickname : "Anonimo",
    description: adv.description,
    images: JSON.stringify(mappedImages),
    edited_images: 1,
    photo_flag: "on",
    postImageRadios: "on",
    contact_method: 0,
    telephone: `+39 ${adv.phone.slice(0, 3)} ${adv.phone.slice(
      3,
      6
    )} ${adv.phone.slice(6, 10)}`,
    telephone_national: adv.phone,
    telephone_international: `+39${adv.phone}`,
    telephone_international_prefix: `+39`,
    telephone_details: JSON.stringify({ contact: `+39${adv.phone}` }),
    whatsapp: adv.whatsapp ? "1" : "0",
    telegram: adv.telegram ? "1" : "0",
  };
  var form_data = new FormData();

  for (var key in advBody) {
    form_data.append(key, advBody[key]);
  }

  let formData1 = form_data;
  let formData2 = tagParser(adv);

  // Create a new FormData object to merge into
  const mergedFormData = new FormData();

  // Loop through formData1 and append its data to the merged FormData
  for (const [key, value] of formData1.entries()) {
    mergedFormData.append(key, value);

    // Check for the contact_method field and append formData2 after it
    if (key === "postImageRadios") {
      for (const [key2, value2] of formData2.entries()) {
        mergedFormData.append(key2, value2);
      }
    }
  }
  const queryString = new URLSearchParams(mergedFormData).toString();
  return queryString;
};

const editGetHeader = (cookie) => ({
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "it",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "sec-ch-ua":
    '"Chromium";v="118", "Google Chrome";v="118", "Not=A?Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  cookie: cookie,
});

const editPostHeader = (cookie, baseURL, private_code) => ({
  authority: "bari.bakecaincontrii.com",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "it",
  "accept-encoding": "gzip, deflate, br",
  "cache-control": "no-cache",
  "content-type": "application/x-www-form-urlencoded",
  cookie: cookie,
  origin: baseURL,
  pragma: "no-cache",
  referer: `${baseURL}/u/post-update/${private_code}/?next=/u/post-manage/${private_code}`,
  "sec-ch-ua":
    '"Chromium";v="118", "Google Chrome";v="118", "Not=A?Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
});

module.exports = {
  firstStepBody,
  pageGetHeader,
  firstPostHeader,
  secondPostHeader,
  secondStepBody,
  thirdStepBody,
  thirdPostHeader,

  //SUSPEND
  suspendPostBody,
  suspendPostHeader,

  //EDIT
  editPostBody,
  editPostHeader,
  editGetHeader,
};
