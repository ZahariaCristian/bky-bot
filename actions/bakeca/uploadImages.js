const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { PROXY } = require("./const");

const API_KEY = fs.readFileSync(__dirname + "/settings/2captchaApiKey.txt", "utf-8", function read(error, data) {
    if (err) {
        throw err;
    }
    var content = data;
    console.log(content);
});

puppeteer.use(StealthPlugin());

const COOKIE_FILE = path.join(__dirname, "cookies.json");
const IMAGE_FOLDER = path.join(__dirname, "images");
const BAKECA_ORIGIN = "https://www.bakeca.it";
const PUBLISH_URL = "https://www.bakeca.it/inserisci/annuncio/sel_categoria/incontri-amore";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

function log(step, message, data) {
    const prefix = `[uploadImages:${step}]`;
    if (typeof data === "undefined") {
        console.log(prefix, message);
        return;
    }

    console.log(prefix, message, data);
}

function getImageFiles(folderPath, limit = 3) {
    if (!fs.existsSync(folderPath)) {
        throw new Error(`Folder not found: ${folderPath}`);
    }

    return fs
        .readdirSync(folderPath)
        .filter((file) => /\.(jpg|jpeg|png|gif|webp)$/i.test(file))
        .slice(0, limit)
        .map((file) => path.join(folderPath, file));
}

function buildUploadParams(fieldName = "allegato") {
    return {
        ts: Date.now().toString(),
        rdn: `${Math.floor(Math.random() * 100000)}${fieldName}`
    };
}

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".png":
            return "image/png";
        case ".gif":
            return "image/gif";
        case ".webp":
            return "image/webp";
        default:
            return "application/octet-stream";
    }
}

function normalizeCookie(cookie) {
    return {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain || ".bakeca.it",
        path: cookie.path || "/",
        expires: typeof cookie.expires === "number" ? cookie.expires : -1,
        httpOnly: Boolean(cookie.httpOnly),
        secure: cookie.secure !== false,
        sameSite: cookie.sameSite || "Lax"
    };
}

async function loadCookies(filePath = COOKIE_FILE) {
    log("cookies", "Loading cookies from file", filePath);

    if (!fs.existsSync(filePath)) {
        throw new Error(`Cookie file not found: ${filePath}`);
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const cookies = JSON.parse(raw);

    if (!Array.isArray(cookies) || cookies.length === 0) {
        throw new Error("Cookie file is empty or invalid.");
    }

    log("cookies", "Cookies loaded", { count: cookies.length });
    return cookies.map(normalizeCookie);
}

function parseUploadResponse(rawText) {
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        return {
            ok: false,
            rawText,
            parsed: null,
            content: null
        };
    }

    let content = parsed.content;
    if (typeof content === "string") {
        try {
            content = JSON.parse(content);
        } catch {
            content = parsed.content;
        }
    }

    return {
        ok: parsed.success === 1 && parsed.code === 200,
        rawText,
        parsed,
        content
    };
}

async function openPublishPage(page) {
    // log("page", "Opening Bakeca homepage");
    // await page.goto(BAKECA_ORIGIN, {
    //     waitUntil: "domcontentloaded",
    //     timeout: 45000
    // });

    log("page", "Opening publish page", PUBLISH_URL);
    await page.goto(PUBLISH_URL, {
        waitUntil: "domcontentloaded",
        timeout: 45000
    });

    log("page", "Publish page loaded");
}

async function uploadOneImageInBrowser(page, filePath, remoteId = "NEW") {
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const { ts, rdn } = buildUploadParams();
    const url = `${BAKECA_ORIGIN}/desktop/inserimento/douploadajax/` +
        `idpriv/${remoteId}/elementname/allegato/ts/${ts}/rdn/${rdn}`;

    const mimeType = getMimeType(filePath);
    const fileBuffer = fs.readFileSync(filePath);
    const base64 = fileBuffer.toString("base64");
    const fileName = path.basename(filePath);

    log("network", "Uploading file from browser context", {
        filePath,
        fileName,
        mimeType,
        url
    });

    const responseData = await page.evaluate(
        async ({ uploadUrl, encodedFile, uploadFileName, uploadMimeType }) => {
            const binary = atob(encodedFile);
            const bytes = new Uint8Array(binary.length);

            for (let i = 0; i < binary.length; i += 1) {
                bytes[i] = binary.charCodeAt(i);
            }

            const blob = new Blob([bytes], { type: uploadMimeType });
            const form = new FormData();
            form.append("allegato", blob, uploadFileName);

            const response = await fetch(uploadUrl, {
                method: "POST",
                body: form,
                credentials: "include",
                headers: {
                    Accept: "*/*"
                }
            });

            const rawText = await response.text();

            return {
                status: response.status,
                ok: response.ok,
                rawText
            };
        },
        {
            uploadUrl: url,
            encodedFile: base64,
            uploadFileName: fileName,
            uploadMimeType: mimeType
        }
    );

    log("network", "Browser upload response", responseData);

    return {
        filePath,
        url,
        ...responseData,
        ...parseUploadResponse(responseData.rawText)
    };
}

async function uploadImagesFromFolder(page, folderPath, limit = 3, remoteId = "NEW") {
    const files = getImageFiles(folderPath, limit);
    log("files", "Selected files for upload", files);

    if (!files.length) {
        return;
    }

    const results = [];

    for (const filePath of files) {
        try {
            const result = await uploadOneImageInBrowser(page, filePath);
            results.push({
                filePath,
                success: result.ok,
                status: result.status,
                parsed: result.parsed,
                content: result.content,
                rawText: result.rawText
            });
        } catch (error) {
            console.error("[uploadImages:error] Upload failed for file:", filePath);
            console.error(error.stack || error.message);
            results.push({
                filePath,
                success: false,
                error: error.message
            });
        }
    }

    return results;
}

module.exports = {
    buildUploadParams,
    getImageFiles,
    getMimeType,
    loadCookies,
    openPublishPage,
    parseUploadResponse,
    uploadOneImageInBrowser,
    uploadImagesFromFolder,
};
