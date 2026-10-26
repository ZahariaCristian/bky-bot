const DEFAULT_BASE_URL = "https://bari.bakecaincontrii.com";

const parseImageResponsePayload = (value) => {
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) return value;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return value;
  }
};

const firstNonEmptyValue = (...values) => {
  for (const value of values) {
    if ((typeof value === "string" || typeof value === "number") && `${value}`.trim()) {
      return `${value}`.trim();
    }
  }
  return "";
};

const pictureSourceValue = (candidate) => {
  const nestedSources = [
    candidate?.urls,
    candidate?.sources,
    candidate?.image,
    candidate?.file,
    candidate?.original,
    candidate?.preview,
    candidate?.thumbnail,
    candidate?.data,
  ].filter((value) => value && typeof value === "object" && !Array.isArray(value));

  const directSource = firstNonEmptyValue(
    candidate?.url,
    candidate?.src,
    candidate?.imageUrl,
    candidate?.image_url,
    typeof candidate?.image === "string" ? candidate.image : "",
    candidate?.fileUrl,
    candidate?.file_url,
    typeof candidate?.file === "string" ? candidate.file : "",
    candidate?.originalUrl,
    candidate?.original_url,
    candidate?.path,
    candidate?.location
  );
  if (directSource) return directSource;

  for (const source of nestedSources) {
    const nestedSource = firstNonEmptyValue(
      source.url,
      source.src,
      source.original,
      source.full,
      source.large,
      source.imageUrl,
      source.image_url,
      source.fileUrl,
      source.file_url,
      source.path,
      source.location
    );
    if (nestedSource) return nestedSource;
  }
  return "";
};

const normalizePictureSource = (source, baseUrl = DEFAULT_BASE_URL) => {
  if (!source || typeof source !== "string") return "";
  try {
    return new URL(source, baseUrl).href;
  } catch (error) {
    return source;
  }
};

const normalizePictureCandidate = (candidate, baseUrl = DEFAULT_BASE_URL) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const uuid = firstNonEmptyValue(
    candidate.uuid,
    candidate.pictureUuid,
    candidate.picture_uuid,
    candidate.imageUuid,
    candidate.image_uuid,
    candidate.guid,
    candidate.uid,
    candidate.data?.uuid,
    candidate.meta?.uuid,
    candidate.picture?.uuid,
    candidate.pictureId,
    candidate.picture_id,
    candidate.imageId,
    candidate.image_id,
    // Newer upload responses can expose the picture identifier simply as `id`.
    candidate.id
  );
  const source = normalizePictureSource(pictureSourceValue(candidate), baseUrl);
  if (!uuid || !source) return null;

  return {
    ...candidate,
    uuid,
    url: source,
    src: source,
  };
};

const collectPictureCandidates = (response, baseUrl = DEFAULT_BASE_URL) => {
  const candidates = [];
  const seen = new Set();
  const visited = new WeakSet();

  const addContainer = (container, depth = 0) => {
    container = parseImageResponsePayload(container);
    if (!container || depth > 6) return;
    if (Array.isArray(container)) {
      container.forEach((entry) => addContainer(entry, depth + 1));
      return;
    }
    if (typeof container !== "object") return;
    if (visited.has(container)) return;
    visited.add(container);

    const normalized = normalizePictureCandidate(container, baseUrl);
    if (normalized) {
      const key = `${normalized.uuid}|${normalized.src}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(normalized);
      }
    }

    Object.values(container).forEach((entry) => {
      if (entry && (typeof entry === "object" || typeof entry === "string")) {
        addContainer(entry, depth + 1);
      }
    });
  };

  addContainer(response);
  return candidates;
};

const responseBodySnippet = (value, maxLength = 1000) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.slice(0, maxLength);
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch (error) {
    return `${value}`.slice(0, maxLength);
  }
};

const summarizeImageResponse = (response, candidates) => {
  const parsedResponse = parseImageResponsePayload(response);
  return {
    responseType: Array.isArray(parsedResponse) ? "array" : typeof parsedResponse,
    responseKeys: parsedResponse && typeof parsedResponse === "object" ? Object.keys(parsedResponse) : [],
    candidateCount: candidates.length,
    candidateUuids: candidates.map((picture) => picture.uuid),
    candidateSources: candidates.map((picture) => picture.src).slice(0, 20),
    status: parsedResponse?.status || parsedResponse?.result || "",
    message: `${parsedResponse?.message || parsedResponse?.error || parsedResponse?.detail || ""}`.slice(0, 500),
    responseBody: responseBodySnippet(parsedResponse),
  };
};

module.exports = {
  collectPictureCandidates,
  normalizePictureCandidate,
  parseImageResponsePayload,
  responseBodySnippet,
  summarizeImageResponse,
};
