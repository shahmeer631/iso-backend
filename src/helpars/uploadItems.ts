import ApiError from "../errors/ApiErrors";
import { uploadToDigitalOceanAWS } from "./uploadToDigitalOceanAWS";

export const uploadItems = async (
  file: Express.Multer.File,
  fileName?: string
) => {
  if (!file) {
    throw new ApiError(400, `${fileName || "File"} is required`);
  }

  return await uploadToDigitalOceanAWS(file);
};