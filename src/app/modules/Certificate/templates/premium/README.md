# Certificate Template Setup Guide

## Current Implementation: HTML/CSS-based (not pixel-perfect)

The current implementation uses HTML/CSS with Puppeteer to generate certificates. While functional, it **cannot achieve 100% pixel-perfect replication** of the reference image because:

1. Border decorative patterns (diamonds/crosses) are very difficult in pure CSS
2. Custom fonts may not render exactly the same
3. Icon positioning and styling may differ slightly
4. Watermark opacity and positioning may vary

---

## Recommended Solution: Image-Based Template

For **100% accurate** certificate generation matching your reference design, follow these steps:

### Step 1: Prepare the Template Image

You need to provide a **blank certificate template** as a high-resolution PNG image (recommended: 1920x1080px or higher).

This image should contain:
- ✅ All borders, decorations, background patterns
- ✅ Logo, "CERTIFICATE OF EXCELLENCE" header text  
- ✅ "This is to certify that" label
- ✅ "has satisfactorily fulfilled..." text
- ✅ "The recipient has verified..." right column header
- ✅ All icons (chart, clipboard, document, gear)
- ✅ Signature line placeholder
- ✅ "10 CPD Credits" badge
- ✅ "Unique Cert. No.:" label
- ✅ "SCAN ME" QR label

**Leave blank spaces for:**
- ❌ Recipient name
- ❌ Course name  
- ❌ Certificate number
- ❌ QR code
- ❌ Signatory name & title

### Step 2: Add the Template File

Place your template image here:
```
src/app/modules/Certificate/templates/premium/certificate-template.png
```

### Step 3: Configure Text Positions

In `certificate.service.ts`, adjust these percentage-based positions to match your template layout:

```typescript
// Recipient name (gold, italic, large)
const recipientX = Math.floor(width * 0.32);  // 32% from left
const recipientY = Math.floor(height * 0.285); // 28.5% from top

// Course name (black, bold, large)
const courseX = Math.floor(width * 0.11);     // 11% from left
const courseY = Math.floor(height * 0.39);    // 39% from top

// Certificate number (navy, small)
const certNoX = Math.floor(width * 0.66);     // 66% from left
const certNoY = Math.floor(height * 0.87);    // 87% from top

// QR code (bottom-right)
const qrX = Math.floor(width * 0.85);         // 85% from left
const qrY = Math.floor(height * 0.82);        // 82% from top
```

### Step 4: Test and Adjust

1. Generate a test certificate
2. Check text positioning
3. Adjust the percentage values above until perfect
4. Repeat until satisfied

---

## Benefits of Image-Based Approach

✅ **100% pixel-perfect** - matches your design exactly  
✅ **Faster rendering** - no HTML/CSS parsing needed  
✅ **Consistent output** - same result every time  
✅ **Easy maintenance** - just replace the PNG to update design  
✅ **Works with any design** - no CSS limitations  

---

## Current Status

⚠️ **Template image not yet provided**

The code is ready to use the image-based approach. Once you add `certificate-template.png`, it will automatically switch to the image-based generation method.

Until then, the HTML/CSS fallback will continue to work (but won't be pixel-perfect).

---

## Need Help?

If you need assistance:
1. Preparing the blank template image
2. Adjusting text positions  
3. Configuring font sizes or colors

Please provide the original design file (PSD, Figma, AI) and we can extract the template image for you.
