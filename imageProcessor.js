const sharp = require("sharp");
const uuid = require("uuid");
const fs = require("fs");

const addText = async (img, phone) => {
  const imageLoaded = sharp(img);
  const imageInfo = await imageLoaded.metadata();

  // Set font size as a percentage of the image height
  const fontSize = Math.floor(imageInfo.height * 0.05); // Adjust the multiplier (0.1) as needed
  const fontWeight = "600";

  // Calculate the text width based on font size
  const textWidth = phone.length * (fontSize * 0.6); // Adjust as needed

  // Position the top text near the center
  const textX = imageInfo.width / 2 - textWidth / 2;
  const textY1 = imageInfo.height / 2 - fontSize; // Top text stays near the center

  // Move the bottom text a bit lower than before
  const textY2 = imageInfo.height - 50; // Adjust this value to position the bottom text

  // Generate the SVG without black rectangles
  const text = `
    <svg width="${imageInfo.width}" height="${imageInfo.height}" xmlns="http://www.w3.org/2000/svg">
      <style type="text/css">@import url('https://fonts.googleapis.com/css?family=Open+Sans');</style>
      <text x="${textX}" y="${textY1}" font-size="${fontSize}px" font-family="Open Sans" font-weight="${fontWeight}" fill="#fdee19">
        ${phone}
      </text>
      <text x="${textX}" y="${textY2}" font-size="${fontSize}px" font-family="Open Sans" font-weight="${fontWeight}" fill="#fdee19">
        ${phone}
      </text>
    </svg>
  `;

  const imageName = `${uuid.v4()}.${img.split(".").pop()}`;

  return new Promise(async (resolve, reject) => {
    try {
      await sharp(img)
        .composite([
          {
            input: Buffer.from(text),
            top: 0,
            left: 0,
          },
        ])
        .toFile(`${process.env.IMAGE_PATH}/${imageName}`); //TODO: random uuid
      resolve(imageName);
    } catch (err) {
      console.log(err);
    }
  });
};

const initImageProcess = async (img, phone) => {
  return await addText(img, phone);
};

const path = "/home/bky-bot/images/";

const imageProcessor = async (imagesArr, adv) => {
  console.log("Received images array:", imagesArr);
  console.log("Received advertisement object:", adv);

  // Check if the images directory exists, create it if not
  if (!fs.existsSync(path)) {
    console.log(`Directory ${path} does not exist. Creating...`);
    fs.mkdirSync(path, { recursive: true });
  }

  var imagesWaiter = [];
  return new Promise(async (resolve, reject) => {
    imagesArr.map((cc, index) => {
      console.log(`Processing image ${index}: ${cc}`);
      imagesWaiter.push(initImageProcess(cc, adv.phone));
    });

    try {
      await Promise.all(imagesWaiter).then((images) => {
        images = images.map((img) => {
          console.log("Processed image path:", img);
          return `${path}${img}`;
        });

        if (images.length > 1) {
          console.log("Multiple images processed successfully:", images);
          resolve(images);
        } else {
          console.log("Single image processed successfully:", images[0]);
          resolve(images[0]);
        }
      });
    } catch (err) {
      console.error("Error processing images:", err);
      reject(err);
    }
  });
};

const unlinkImages = async (imagesArr) => {
  /* console.log("Unlinking", imagesArr);
  imagesArr.forEach((ia) => {
    fs.unlinkSync(ia);
  }); */
  return;
};

module.exports = {
  imageProcessor,
  unlinkImages,
};
