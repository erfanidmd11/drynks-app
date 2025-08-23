// src/screens/Dates/utils/uploadToDateBucket.ts
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { supabase } from '@config/supabase';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { decode as atob } from 'base-64';

const BUCKET = 'date-photos';

// Convert base64 -> bytes (RN-safe)
function base64ToBytes(b64: string) {
  const bin =
    typeof (globalThis as any).atob === 'function'
      ? (globalThis as any).atob(b64)
      : atob(b64);

  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Upload an image to Supabase Storage
 * @param localUri local file URI (from picker/camera)
 * @param creatorId user id
 * @param dateId date request id
 * @returns { path, publicUrl }
 */
export async function uploadImageToDateBucket(
  localUri: string,
  creatorId: string,
  dateId: string
): Promise<{ path: string; publicUrl: string }> {
  // 1) Convert to JPEG (avoid HEIC/webp issues; cap size)
  const manipulated = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: 1600 } }],
    { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
  );

  // 2) Read as base64 and convert to bytes
  const base64 = await FileSystem.readAsStringAsync(manipulated.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = base64ToBytes(base64);
  if (!bytes.length) throw new Error('Image read resulted in 0 bytes.');

  // 3) Build storage path
  const filename = `${uuidv4()}.jpg`;
  const path = `${creatorId}/${dateId}/${filename}`;

  // 4) Upload to Supabase Storage
  const { error } = await supabase
    .storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });

  if (error) throw error;

  // 5) Get public URL
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Could not generate public URL.');

  return { path, publicUrl: data.publicUrl };
}
