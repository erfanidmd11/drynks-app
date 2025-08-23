import { supabase } from '@config/supabase';

function filenameFromUri(uri: string, fallbackExt = 'jpg') {
  const last = uri.split('?')[0].split('/').pop() || `photo.${fallbackExt}`;
  return /\.[a-z0-9]+$/i.test(last) ? last : `${last}.${fallbackExt}`;
}
function contentTypeFromName(name: string) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  return 'application/octet-stream';
}

/**
 * Uploads a cover image to 'date-photos' and updates public.date_requests:
 *   - profile_photo = public URL (used as cover)
 *   - photo_urls = [public URL]  (gallery)
 */
export async function uploadDateCoverToDateRequests(params: {
  dateId: string;
  creatorId: string;
  localUri: string;   // file://… or https://… from ImagePicker/Camera
}) {
  const { dateId, creatorId, localUri } = params;
  if (!dateId || !creatorId || !localUri) throw new Error('missing args');

  const name = filenameFromUri(localUri);
  const path = `${creatorId}/${dateId}/${Date.now()}_${name}`;

  // Read file into Blob (works for file:// and https:// in Expo)
  const resp = await fetch(localUri);
  if (!resp.ok) throw new Error(`read file failed: ${resp.status}`);
  const blob = await resp.blob();

  // ✅ Upload to public bucket 'date-photos' via Storage
  const { error: upErr } = await supabase
    .storage
    .from('date-photos')
    .upload(path, blob as any, { contentType: contentTypeFromName(name), upsert: true });

  if (upErr) throw upErr;

  const pub = supabase.storage.from('date-photos').getPublicUrl(path);
  const url = pub?.data?.publicUrl;
  if (!url) throw new Error('public URL not available');

  // Update the row so cards can render it immediately
  const { error: rowErr } = await supabase
    .from('date_requests')
    .update({
      profile_photo: url,
      photo_urls: [url], // or append if you already have others
    })
    .eq('id', dateId);
  if (rowErr) throw rowErr;

  return { url, path };
}
