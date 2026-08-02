import productPackage from "../package.json" with { type: "json" };

export const PRODUCT_VERSION = productPackage.version;
