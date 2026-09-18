// Script to clean template - remove [RECIPIENT'S FULL NAME], QR code, and cert ID
const sharp = require('sharp');
const path = require('path');

const templatePath = path.join(__dirname, 'src/app/modules/Certificate/templates/premium/certificate-template.png');
const outputPath = path.join(__dirname, 'src/app/modules/Certificate/templates/premium/certificate-template-cleaned.png');

(async () => {
  try {
    const image = sharp(templatePath);
    const metadata = await image.metadata();
    const width = metadata.width;
    const height = metadata.height;

    console.log(`Template size: ${width}x${height}`);

    // Create cream-colored rectangles to cover placeholders
    const coverRecipient = Buffer.from(`
      <svg width="${width}" height="${height}">
        <rect x="${Math.floor(width * 0.098)}" y="${Math.floor(height * 0.345)}" 
              width="${Math.floor(width * 0.47)}" height="${Math.floor(height * 0.058)}" 
              fill="#f0e8cc" stroke="none"/>
      </svg>
    `);

    const coverCertNo = Buffer.from(`
      <svg width="${width}" height="${height}">
        <rect x="${Math.floor(width * 0.595)}" y="${Math.floor(height * 0.893)}" 
              width="${Math.floor(width * 0.185)}" height="${Math.floor(height * 0.037)}" 
              fill="#f0e8cc" stroke="none"/>
      </svg>
    `);

    const coverQR = Buffer.from(`
      <svg width="${width}" height="${height}">
        <rect x="${Math.floor(width * 0.858)}" y="${Math.floor(height * 0.823)}" 
              width="${Math.floor(width * 0.082)}" height="${Math.floor(height * 0.11)}" 
              fill="#f0e8cc" stroke="none"/>
      </svg>
    `);

    // Apply all covers
    await image
      .composite([
        { input: coverRecipient, top: 0, left: 0, blend: 'over' },
        { input: coverCertNo, top: 0, left: 0, blend: 'over' },
        { input: coverQR, top: 0, left: 0, blend: 'over' },
      ])
      .png()
      .toFile(outputPath);

    console.log(`✅ Cleaned template saved to: ${outputPath}`);
    console.log('Now replace the original template with this cleaned version.');
  } catch (error) {
    console.error('❌ Error:', error);
  }
})();
