# Stock Upload Crop Improvement Idea

## Goal

Improve Indian equity screenshot extraction accuracy by letting users crop the screenshot before processing.

## Recommended Flow

1. User uploads a stock positions screenshot normally.
2. Show an image preview with an optional crop box.
3. Show helper text:
   "For better accuracy, crop only the stock positions list. Keep stock name, P&L, Qty/Avg, product type, and LTP visible. Avoid index headers and Total P&L."
4. User can choose:
   - Use full image
   - Use cropped positions area
5. Backend sends the selected image area to OCR/Gemini.

## Important

Do not ask users to crop only the P&L numbers. The crop should include the full stock rows so extraction can match each P&L to the correct stock symbol.

Each visible row should ideally include:

- Stock symbol/name
- Product type, such as MIS/CNC/Delivery
- Qty and Avg
- Row-level P&L
- LTP

## Why This Helps

- Removes NIFTY/SENSEX/BANKNIFTY header values.
- Removes Total P&L confusion.
- Removes navigation/status-bar noise.
- Keeps Gemini and OCR focused on actual position rows.
- Improves multi-stock row matching.

## Product Note

Make cropping optional, not mandatory. Keep full-image extraction as the default fallback for quick uploads.
