// src/screens/Dates/utils/uploadToDateBucket.ts
// Expo SDK 54/55 compatible (no expo-file-system).
// - Converts picked image to JPEG + base64 in one pass via ImageManipulator
// - Uploads Uint8Array bytes to Supabase Storage
// - Stable path: {creatorId}/{dateId}/{uuid}.jpg

import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import * as ImageManipulator from 'expo-image-manipulator';
import { decode as atob } from 'base-64';
import { supabase } from '@config/supabase';

const BUCKET = 'date-photos';

// Convert base64 -> bytes (RN-safe)
function base64ToBytes(b64: string): Uint8Array {
  const bin =
    typeof (globalThis as any).atob === 'function'
      ? (globalThis as any).atob(b64)
      : atob(b64);

  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Upload an image to Supabase Storage.
 * @param localUri  Local file URI (from picker/camera)
 * @param creatorId Current user id
 * @param dateId    Date request id
 * @returns { path, publicUrl }
 */
export async function uploadImageToDateBucket(
  localUri: string,
  creatorId: string,
  dateId: string
): Promise<{ path: string; publicUrl: string }> {
  // 1) Convert to JPEG (avoid HEIC/webp issues) and return base64 directly
  const manipulated = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: 1600 } }],
    {
      compress: 0.82,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true, // <-- key: no expo-file-system needed
    }
  );

  if (!manipulated.base64) {
    throw new Error('Failed to read image data (no base64 returned).');
  }
  const bytes = base64ToBytes(manipulated.base64);
  if (!bytes.length) throw new Error('Image read resulted in 0 bytes.');

  // 2) Build storage path
  const filename = `${uuidv4()}.jpg`;
  const path = `${creatorId}/${dateId}/${filename}`;

  // 3) Upload to Supabase Storage
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: 'image/jpeg',
      upsert: false,
      cacheControl: '3600',
    });

  if (error) throw error;

  // 4) Get public URL
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Could not generate public URL.');

  return { path, publicUrl: data.publicUrl };
}
