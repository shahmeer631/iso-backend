/* eslint-disable no-console */
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import httpStatus from "http-status";
import ApiError from "../errors/ApiErrors";

dotenv.config({ path: path.join(process.cwd(), ".env") });

interface UploadResponse {
  Location: string;
}

// Define the expected file object structure
// interface FileObject {
//   originalname: string;
//   path?: string; // Making path optional since it might not exist
//   buffer?: Buffer; // Adding buffer for when path isn't available
//   mimetype: string;
// }

export const s3Client = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
  forcePathStyle: true,
});

export const uploadToDigitalOceanAWS = async (
  file: Express.Multer.File,
): Promise<UploadResponse> => {
  try {
    let fileBody: Buffer | Readable;

    if (file.buffer) {
      fileBody = file.buffer;
    } else if (file.path) {
      fileBody = fs.createReadStream(file.path);
    } else {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid file data");
    }

    let folder = "files";

    if (file.mimetype.startsWith("image")) folder = "images";
    if (file.mimetype === "application/pdf") folder = "documents";
    if (file.mimetype.startsWith("video")) folder = "videos";

    const cleanName = file.originalname.replace(/\s+/g, "-");
    const fileKey = `${folder}/${Date.now()}-${cleanName}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: fileKey,
        Body: fileBody,
        ContentType: file.mimetype,
        ContentDisposition: "inline",
        ACL: "public-read",
      }),
    );

    return {
      Location: `https://s3.${process.env.S3_REGION}.amazonaws.com/${process.env.S3_BUCKET}/${fileKey}`,
    };
  } catch (error) {
    console.error("S3 upload error:", error);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, "File upload failed");
  }
};
