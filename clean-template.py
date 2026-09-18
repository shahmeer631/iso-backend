#!/usr/bin/env python3
"""Clean certificate template - remove placeholders with cream rectangles"""

from PIL import Image, ImageDraw
import os

# Paths
template_path = "src/app/modules/Certificate/templates/premium/certificate-template-original-backup.png"
output_path = "src/app/modules/Certificate/templates/premium/certificate-template.png"

# Load image
img = Image.open(template_path)
width, height = img.size
print(f"Template size: {width}x{height}")

# Create drawing context
draw = ImageDraw.Draw(img)

# Cream color matching template background
cream = "#f0e8cc"

# Cover [RECIPIENT'S FULL NAME]
rect1_x = int(width * 0.098)
rect1_y = int(height * 0.345)
rect1_w = int(width * 0.47)
rect1_h = int(height * 0.058)
draw.rectangle(
    [rect1_x, rect1_y, rect1_x + rect1_w, rect1_y + rect1_h],
    fill=cream
)
print(f"✓ Covered [RECIPIENT'S FULL NAME] at ({rect1_x}, {rect1_y})")

# Cover certificate number
rect2_x = int(width * 0.595)
rect2_y = int(height * 0.893)
rect2_w = int(width * 0.185)
rect2_h = int(height * 0.037)
draw.rectangle(
    [rect2_x, rect2_y, rect2_x + rect2_w, rect2_y + rect2_h],
    fill=cream
)
print(f"✓ Covered cert number at ({rect2_x}, {rect2_y})")

# Cover QR code
rect3_x = int(width * 0.858)
rect3_y = int(height * 0.823)
rect3_w = int(width * 0.082)
rect3_h = int(height * 0.11)
draw.rectangle(
    [rect3_x, rect3_y, rect3_x + rect3_w, rect3_y + rect3_h],
    fill=cream
)
print(f"✓ Covered QR code at ({rect3_x}, {rect3_y})")

# Save cleaned template
img.save(output_path, "PNG", quality=95)
print(f"\n✅ Cleaned template saved to: {output_path}")
print("Template is now ready - placeholders removed!")
