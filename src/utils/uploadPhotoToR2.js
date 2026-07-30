import imageCompression from 'browser-image-compression'
import { diasClient } from '../lib/supabase'

/**
 * Compress image for personnel profile (~0.6MB, max width 1920).
 * @param {File} file
 * @returns {Promise<File>}
 */
export async function compressPersonnelPhoto(file) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('Επίλεξε αρχείο εικόνας')
  }
  const compressed = await imageCompression(file, {
    maxSizeMB: 0.6,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
    fileType: 'image/jpeg',
    initialQuality: 0.85,
  })
  const name = String(file.name || 'photo.jpg').replace(/\.[^.]+$/, '') + '.jpg'
  return new File([compressed], name, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  })
}

/**
 * Upload personnel profile photo via DIAS Supabase Edge Function → Cloudflare R2.
 * Returns the public URL only — does NOT save to DB (caller patches photo_url, then Save).
 *
 * @param {File} file
 * @param {string} [techId]
 * @param {import('@supabase/supabase-js').SupabaseClient} [supabaseClient] — default diasClient
 * @returns {Promise<string>} public R2 URL
 */
export async function uploadPersonnelPhoto(file, techId = '', supabaseClient = diasClient) {
  if (!file) throw new Error('Δεν επιλέχθηκε αρχείο')

  const compressed = await compressPersonnelPhoto(file)
  const formData = new FormData()
  formData.append('file', compressed, compressed.name || 'photo.jpg')
  if (techId) {
    formData.append('techId', String(techId))
    formData.append('techName', String(techId))
  }

  const { data, error } = await supabaseClient.functions.invoke('upload-r2-photo', {
    body: formData,
  })

  if (error) {
    throw new Error(error.message || 'Αποτυχία κλήσης Edge Function upload-r2-photo')
  }

  const payload = typeof data === 'string' ? safeJson(data) : data
  if (!payload?.success || !payload?.url) {
    throw new Error(payload?.error || 'Δεν επιστράφηκε URL από το R2 upload')
  }

  return String(payload.url)
}

function safeJson(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
