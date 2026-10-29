const getCompatibilityCanvas = (metadata = {}) => {
  const orientation = Number(metadata.orientation || 1);
  const swapsDimensions = [5, 6, 7, 8].includes(orientation);
  const sourceWidth = swapsDimensions ? metadata.height : metadata.width;
  const sourceHeight = swapsDimensions ? metadata.width : metadata.height;

  if (sourceWidth > sourceHeight) return { width: 1600, height: 1200 };
  if (sourceHeight > sourceWidth) return { width: 1200, height: 1600 };
  return { width: 1400, height: 1400 };
};

module.exports = { getCompatibilityCanvas };
