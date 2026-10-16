ALTER TABLE "FlashSale"
  ADD CONSTRAINT "FlashSale_totalQuantity_nonnegative"
    CHECK ("totalQuantity" > 0),
  ADD CONSTRAINT "FlashSale_availableQuantity_nonnegative"
    CHECK ("availableQuantity" >= 0),
  ADD CONSTRAINT "FlashSale_soldQuantity_nonnegative"
    CHECK ("soldQuantity" >= 0),
  ADD CONSTRAINT "FlashSale_quantity_consistency"
    CHECK ("availableQuantity" + "soldQuantity" <= "totalQuantity");
