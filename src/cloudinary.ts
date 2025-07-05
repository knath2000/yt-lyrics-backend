// src/cloudinary.ts
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  // The library automatically picks up CLOUDINARY_URL from process.env
  // but we can be explicit for clarity.
  cloudinary_url: process.env.CLOUDINARY_URL, 
});

export { cloudinary };