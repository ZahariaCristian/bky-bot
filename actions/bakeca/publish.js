const puppeteer = require("puppeteer-extra");
const RecaptchaPlugin = require("puppeteer-extra-plugin-recaptcha");
const TwoCaptcha = require("@2captcha/captcha-solver")
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { PROXY } = require("./const");
const {
    loadCookies,
    openPublishPage,
    uploadImagesFromFolder
} = require("./uploadImages");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const INSERT_URL = "https://www.bakeca.it/desktop/inserimento/insert";
const COMUNE_LOOKUP_URL = "https://www.bakeca.it/lws/comune/get/";
const PUBLISH_INCONTRII_URL = "https://www.bakeca.it/inserisci/annuncio/sel_categoria/incontri-amore";
const PUBLISH_MASSAGGI_URL = "https://www.bakeca.it/inserisci/annuncio/sel_categoria/incontri-amore";

const API_KEY = fs.readFileSync(__dirname + "/settings/2captchaApiKey.txt", "utf-8", function read(error, data) {
    if (err) {
        throw err;
    }
    var content = data;
    console.log(content);
});
const solver = new TwoCaptcha.Solver(API_KEY)

puppeteer.use(
    StealthPlugin(),
    RecaptchaPlugin({
        provider: {
            id: "2captcha",
            token: API_KEY,
        },
        visualFeedback: true,
        throwOnError: true
    })
);

function log(step, message, data) {
    const prefix = `[publishAds:${step}]`;
    if (typeof data === "undefined") {
        console.log(prefix, message);
        return;
    }
}

function firstNonEmpty(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }

    return "";
}

// function sanitizeMaxLength(value, maxLength) {
//     const normalized = firstNonEmpty(value);
//     if (!normalized) {
//         return "";
//     }

//     return normalized.length <= maxLength ? normalized : "";
// }

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function solveAndInjectTurnstile(page, solver) {
    try {
        // Step 1: Solve Turnstile via 2Captcha
        const solution = await solver.cloudflareTurnstile({
            pageurl: PUBLISH_INCONTRII_URL,
            sitekey: "0x4AAAAAAC2oyZpwPbaJseO0"
        });
        console.log('Turnstile token received:', solution);
        // Step 2: Wait for hidden input to appear
        await page.waitForSelector('input[name="g-recaptcha-response"]', {
            visible: false,
            timeout: 10000
        });

        // Step 3: Inject token into inputs with retries
        for (let i = 0; i < 2; i++) {
            const success = await page.evaluate((token) => {
                const turnstileInput = document.querySelector('input[name="cf-turnstile-response"]');
                const recaptchaInput = document.querySelector('input[name="g-recaptcha-response"]');
                let injected = false;
                if (turnstileInput) {
                    turnstileInput.value = token;
                    turnstileInput.setAttribute('value', token);
                    turnstileInput.dispatchEvent(new Event('input', { bubbles: true }));
                    turnstileInput.dispatchEvent(new Event('change', { bubbles: true }));
                    injected = true;
                }
                if (recaptchaInput) {
                    recaptchaInput.value = token;
                    recaptchaInput.setAttribute('value', token);
                    recaptchaInput.dispatchEvent(new Event('input', { bubbles: true }));
                    recaptchaInput.dispatchEvent(new Event('change', { bubbles: true }));
                    injected = true;
                }
                return injected;
            }, solution.data);

            if (success) {
                console.log('Token successfully injected');
                break;
            }
            console.warn('Injection failed, retrying...');
            await delay(1000);
        }

        // Step 4 (Optional): Submit the form manually if the site doesn't do it
        try {
            await page.$eval('button[type="submit"]', btn => {
                btn.removeAttribute("disabled");
                btn.click();
            });


        } catch (outerErr) {
            console.error('Error evaluating form submission:', outerErr);
        }

        return solution;
    } catch (err) {
        console.error('Error solving/injecting Turnstile:', err);
        throw err;
    }
}

async function readPublishContext(page) {
    return page.evaluate(() => {
        const readValue = (selector) => {
            const node = document.querySelector(selector);
            if (!node) {
                return "";
            }

            return node.value || node.getAttribute("value") || "";
        };

        const checkedValues = (selector) => {
            return Array.from(document.querySelectorAll(selector))
                .filter((node) => node.checked)
                .map((node) => node.value || "on");
        };

        return {
            idpriv: readValue('input[name="idpriv"]'),
            idprivsign: readValue('input[name="idprivsign"]'),
            sezione: readValue('input[name="sezione"]'),
            categoria: readValue('input[name="categoria"]'),
            trans: readValue('input[name="trans"]'),
            comune: readValue('input[name="comune"]'),
            sel_provincia: readValue('select[name="sel_provincia"]') || readValue('input[name="sel_provincia"]'),
            sel_comune: readValue('select[name="sel_comune"]') || readValue('input[name="sel_comune"]'),
            tiporeply: readValue('input[name="tiporeply"]') || readValue('select[name="tiporeply"]'),
            privacyValues: checkedValues('input[name="consenso_privacy"]'),
            consensoEsplicito: checkedValues('input[name="consensoesplicito"]'),
            consensoEsplicitoA: checkedValues('input[name="consensoesplicitoa"]'),
            consensoEsplicitoB: checkedValues('input[name="consensoesplicitob"]'),
            reCaptcha: readValue('input[name="g-recaptcha-response"]')
        };
    });
}

async function resolveLocationData(page, comuneQuery, publishContext = {}) {
    const normalizedQuery = firstNonEmpty(comuneQuery, publishContext.comune);

    if (!normalizedQuery) {
        return {
            comune: firstNonEmpty(publishContext.comune),
            sel_provincia: firstNonEmpty(publishContext.sel_provincia),
            sel_comune: firstNonEmpty(publishContext.sel_comune),
            suggestion: null
        };
    }

    log("location", "Resolving location from Bakeca API", normalizedQuery);

    const response = await page.evaluate(
        async ({ url, query }) => {
            const targetUrl = `${url}?query=${encodeURIComponent(query)}`;
            const response = await fetch(targetUrl, {
                method: "POST",
                credentials: "include",
                headers: {
                    Accept: "application/json, text/plain, */*"
                }
            });

            const text = await response.text();
            let parsed = null;

            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = null;
            }

            return {
                status: response.status,
                ok: response.ok,
                text,
                parsed
            };
        },
        {
            url: COMUNE_LOOKUP_URL,
            query: normalizedQuery
        }
    );

    log("location", "Location API response", response);

    const firstSuggestion = response.parsed?.suggestions?.[0] || null;

    return {
        comune: firstNonEmpty(firstSuggestion?.description, normalizedQuery, publishContext.comune),
        sel_provincia: firstNonEmpty(firstSuggestion?.provincia, publishContext.sel_provincia),
        sel_comune: firstNonEmpty(firstSuggestion?.comune, publishContext.sel_comune),
        suggestion: firstSuggestion
    };
}

async function buildPublishPayload(adData, publishContext, imageIds, locationData = {}) {
    const coverId = imageIds[0] || "";
    const payload = {
        titolo: adData.titolo,
        testo: adData.testo,
        cercoamoreincontri: adData.cercoamoreincontri || "",
        // trans: firstNonEmpty(adData.trans, publishContext.trans),
        copertina_img: firstNonEmpty(adData.copertina_img, coverId),
        allegato_img: imageIds,
        comune: firstNonEmpty(adData.comune, locationData.comune, publishContext.comune),
        geo_indirizzo: firstNonEmpty(adData.geo_indirizzo, ""),
        email: adData.email,
        contattotelefonico: adData.contattotelefonico,
        tiporeply: firstNonEmpty(adData.tiporeply, publishContext.tiporeply, "4"),
        consenso_privacy: 'consenso_privacy',
        // consenso_privacy: adData.consenso_privacy || publishContext.privacyValues,
        // consensoesplicito: adData.consensoesplicito || publishContext.consensoEsplicito,
        // consensoesplicitoa: adData.consensoesplicitoa || publishContext.consensoEsplicitoA,
        // consensoesplicitob: adData.consensoesplicitob || publishContext.consensoEsplicitoB,
        idpriv: firstNonEmpty(adData.idpriv, publishContext.idpriv),
        idprivsign: firstNonEmpty(adData.idprivsign, publishContext.idprivsign),
        sezione: firstNonEmpty(adData.sezione, publishContext.sezione),
        categoria: firstNonEmpty(adData.categoria, publishContext.categoria, "incontri-amore"),
        sel_provincia: firstNonEmpty(adData.sel_provincia, locationData.sel_provincia, publishContext.sel_provincia),
        sel_comune: firstNonEmpty(adData.sel_comune, locationData.sel_comune, publishContext.sel_comune),
        cap: firstNonEmpty(adData.cap, ""),
        civico: firstNonEmpty(adData.civico, ""),
        indirizzo: firstNonEmpty(adData.indirizzo, ""),
        lat: firstNonEmpty(adData.lat, ""),
        lng: firstNonEmpty(adData.lng, ""),
    };

    return payload;
}

async function submitPublishRequest(page, payload) {
    const allegatoFiles = (payload.allegato_files || [])
        .filter((filePath) => filePath && fs.existsSync(filePath))
        .map((filePath) => ({
            name: path.basename(filePath),
            type: /\.(jpe?g)$/i.test(filePath)
                ? "image/jpeg"
                : /\.png$/i.test(filePath)
                    ? "image/png"
                    : /\.gif$/i.test(filePath)
                        ? "image/gif"
                        : /\.webp$/i.test(filePath)
                            ? "image/webp"
                            : "application/octet-stream",
            base64: fs.readFileSync(filePath).toString("base64")
        }));

    log("submit", "Submitting ad payload", payload);

    // Solve CAPTCHA (leaving your function call as-is)
    try {
        const solution = await solveAndInjectTurnstile(page, solver);
        payload['g-recaptcha-response'] = solution.data;
        console.log(solution.data, "solution data")
    } catch (err) {
        console.warn("[!] Turnstile solver 500 error, restarting bot and retrying login.");
    }
    // ===== WAIT NAVIGATION =====
    await page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: 30000
    }).catch(() => { });
}


async function fillPublishForm(page, payload) {
    log("form", "Filling publish form in browser");

    await page.evaluate((payloadData) => {
        const asArray = (value) => {
            if (Array.isArray(value)) {
                return value.filter((item) => item !== "" && item != null);
            }

            if (value === "" || value == null) {
                return [];
            }

            return [value];
        };

        const setValue = (selector, value) => {
            const node = document.querySelector(selector);
            if (!node) {
                return;
            }

            node.value = value == null ? "" : value;
            node.dispatchEvent(new Event("input", { bubbles: true }));
            node.dispatchEvent(new Event("change", { bubbles: true }));
        };

        const setRadioValue = (name, value) => {
            if (value == null || value === "") {
                return;
            }

            const nodes = Array.from(document.querySelectorAll(`input[type="radio"][name="${name}"]`));
            if (!nodes.length) {
                return;
            }

            nodes.forEach((node) => {
                node.checked = node.value === value;
                node.dispatchEvent(new Event("change", { bubbles: true }));
            });
        };

        const removeExistingHidden = (name) => {
            document
                .querySelectorAll(`input[type="hidden"][name="${name}"], input[type="hidden"][name="${name}[]"]`)
                .forEach((node) => node.remove());
        };

        const appendHidden = (name, value) => {
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = name;
            input.value = value;
            document.body.appendChild(input);
        };

        const setCheckboxGroup = (name, values) => {
            const wanted = asArray(values);
            const nodes = Array.from(document.querySelectorAll(`input[name="${name}"]`));
            if (!nodes.length) {
                return;
            }

            nodes.forEach((node) => {
                const shouldCheck = wanted.includes(node.value) || (node.value === "" && wanted.includes("on"));
                node.checked = shouldCheck;
                node.dispatchEvent(new Event("change", { bubbles: true }));
            });
        };

        setValue('input[name="titolo"]', payloadData.titolo);
        setValue('textarea[name="testo"]', payloadData.testo);
        setValue('input[name="comune"]', payloadData.comune);
        setValue('input[name="geo_indirizzo"]', payloadData.geo_indirizzo);
        setValue('input[name="email"]', payloadData.email);
        setValue('input[name="contattotelefonico"]', payloadData.contattotelefonico);
        setValue('input[name="cap"]', payloadData.cap);
        setValue('input[name="civico"]', payloadData.civico);
        setValue('input[name="indirizzo"]', payloadData.indirizzo);
        setValue('input[name="lat"]', payloadData.lat);
        setValue('input[name="lng"]', payloadData.lng);
        setValue('input[name="idpriv"]', payloadData.idpriv);
        setValue('input[name="idprivsign"]', payloadData.idprivsign);
        setValue('input[name="sezione"]', payloadData.sezione);
        setValue('input[name="categoria"]', payloadData.categoria);
        setValue('input[name="copertina_img"]', payloadData.copertina_img);

        setValue('input[name="sel_provincia"]', payloadData.sel_provincia);
        setValue('input[name="sel_comune"]', payloadData.sel_comune);
        // setValue('input[name="g-recaptcha-response"]', payloadData['g-recaptcha-response']);

        if (Object.prototype.hasOwnProperty.call(payloadData, "localita")) {
            setValue('input[name="localita"]', payloadData.localita);
        }

        if (Object.prototype.hasOwnProperty.call(payloadData, "nome")) {
            setValue('input[name="nome"]', payloadData.nome);
        }

        if (Object.prototype.hasOwnProperty.call(payloadData, "cognome")) {
            setValue('input[name="cognome"]', payloadData.cognome);
        }

        if (Object.prototype.hasOwnProperty.call(payloadData, "contattotelefonico2")) {
            setValue('input[name="contattotelefonico2"]', payloadData.contattotelefonico2);
        }

        setRadioValue("cercoamoreincontri", payloadData.cercoamoreincontri);
        setRadioValue("tiporeply", payloadData.tiporeply);

        setCheckboxGroup("consenso_privacy", payloadData.consenso_privacy);
        setCheckboxGroup("consensoesplicito", payloadData.consensoesplicito);
        setCheckboxGroup("consensoesplicitoa", payloadData.consensoesplicitoa);
        setCheckboxGroup("consensoesplicitob", payloadData.consensoesplicitob);

        removeExistingHidden("allegato_img");
        asArray(payloadData.allegato_img).forEach((id) => appendHidden("allegato_img[]", id));

        if (payloadData.copertina_img) {
            appendHidden("copertina_img", payloadData.copertina_img);
        }
    }, payload);

    log("form", "Publish form filled");
}

async function waitForManualCaptchaAndSubmit(page, payload) {
    // log("captcha", "Waiting for manual CAPTCHA solve");
    // await waitForEnter("Solve the CAPTCHA in the browser, then press Enter here to submit the ad...");
    // log("captcha", "Manual confirmation received");
    return submitPublishRequest(page, payload);
}

async function publishAd(page, adData) {
    const publishContext = await readPublishContext(page);
    log("context", "Publish context from page", publishContext);

    const locationData = await resolveLocationData(page, adData.comune, publishContext);
    log("location", "Resolved location data", locationData);

    const uploadResults = await uploadImagesFromFolder(page, adData.imageFolder, adData.imageLimit || 3, publishContext.idpriv || "NEW");
    log("images", "Upload results", uploadResults);
    let imageIds = []
    if (uploadResults) {
        const failedUploads = uploadResults.filter((item) => !item.success || !item.content?.idUnico);
        if (failedUploads.length > 0) {
            console.log(`Image upload failed for ${failedUploads.length} file(s).`);
        }
        imageIds = uploadResults.map((item) => item.content.idUnico);
    }

    const payload = await buildPublishPayload(adData, publishContext, imageIds, locationData);
    payload.allegato_img = []
    if (uploadResults) {
        payload.allegato_files = uploadResults.map((item) => item.filePath).filter(Boolean);
    }
    await fillPublishForm(page, payload);
    const submitResult = await waitForManualCaptchaAndSubmit(page, payload);

    return {
        uploadResults,
        imageIds,
        payload,
        submitResult
    };
}

async function run() {
    let browser;

    try {
        const cookies = await loadCookies();

        log("browser", "Launching browser with proxy", {
            host: PROXY.host,
            port: PROXY.port
        });

        browser = await puppeteer.launch({
            headless: false,
            executablePath: puppeteer.executablePath(),
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                // "--disable-infobars",
                // "--disable-web-security",
                // "--disable-features=IsolateOrigins,site-per-process",
                `--proxy-server=http://${PROXY.host}:${PROXY.port}`
            ],
            defaultViewport: null
        });

        const page = await browser.newPage();
        log("browser", "New page created");

        await page.authenticate({
            username: PROXY.username,
            password: PROXY.password
        });
        log("browser", "Proxy authentication configured");

        await page.setUserAgent(USER_AGENT);
        log("browser", "User agent set");

        await page.setCookie(...cookies);
        log("browser", "Cookies applied to page");

        await openPublishPage(page);

        const result = await publishAd(page, {
            titolo: "This is Test ADS now",
            testo: "This is Test ADS now",
            cercoamoreincontri: "trans",
            email: "raffaelesorrentino74@yahoo.it",
            contattotelefonico: "3510389887",
            tiporeply: "4",
            comune: "Roma",
            sel_provincia: "roma",
            sel_comune: "058091",
            categoria: "incontri-amore",
            sezione: "cita",
            imageFolder: "./images",
            imageLimit: 3
        });

        log("result", "Publish flow result", result);
        console.log(JSON.stringify(result, null, 2));
        return result;
    } catch (error) {
        console.error("[publishAds:error] Publish flow failed:", error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        throw error;
    }
}

if (require.main === module) {
    run().catch(() => {
        process.exitCode = 1;
    });
}

module.exports = {
    buildPublishPayload,
    publishAd,
    readPublishContext,
    resolveLocationData,
    submitPublishRequest,
    run,
}
