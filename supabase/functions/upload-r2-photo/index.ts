/**
 * DIAS ERP — Upload personnel profile photo to Cloudflare R2.
 * Requires DIAS authenticated JWT (verify_jwt = true + in-function check).
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 * Optional: R2_PUBLIC_BASE_URL
 */
import { createClient } from 'npm:@supabase/supabase-js@2.49.1'
import { S3Client, PutObjectCommand } from 'npm:@aws-sdk/client-s3@3.758.0'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function extensionForMime(mime: string) {
  const m = String(mime || '').toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  return 'jpg'
}

function sanitizeSegment(value: string, fallback = 'unknown') {
  const s = String(value || '')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 60)
  return s || fallback
}

function publicUrlForKey(objectKey: string) {
  const base = Deno.env.get('R2_PUBLIC_BASE_URL')
  if (base) {
    return `${String(base).replace(/\/$/, '')}/${objectKey}`
  }
  const endpoint = String(Deno.env.get('R2_ENDPOINT_URL') || '').replace(/\/$/, '')
  const bucket = Deno.env.get('R2_BUCKET_NAME')
  if (endpoint && bucket) {
    return `${endpoint}/${bucket}/${objectKey}`
  }
  return objectKey
}

function getR2Client() {
  const endpoint = Deno.env.get('R2_ENDPOINT_URL')
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 credentials missing (R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)',
    )
  }
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  })
}

/** Απαιτεί έγκυρο DIAS user JWT (Bearer). */
async function requireDiasUser(req: Request) {
  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { user: null as null, error: 'Missing Authorization bearer token' }
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !supabaseAnon) {
    return { user: null as null, error: 'Supabase env missing in Edge Function' }
  }
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    return { user: null as null, error: 'Unauthorized' }
  }
  return { user: data.user, error: null as null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405)
  }

  try {
    const auth = await requireDiasUser(req)
    if (!auth.user) {
      return jsonResponse({ success: false, error: auth.error || 'Unauthorized' }, 401)
    }

    const bucket = Deno.env.get('R2_BUCKET_NAME')
    if (!bucket) throw new Error('R2_BUCKET_NAME is not configured')

    const contentType = req.headers.get('content-type') || ''
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return jsonResponse(
        { success: false, error: 'Expected multipart/form-data' },
        400,
      )
    }

    const form = await req.formData()
    const file =
      (form.get('file') as File | null) ||
      (form.get('photo') as File | null) ||
      (form.get('files') as File | null)

    if (!file || typeof file === 'string' || !file.size) {
      return jsonResponse({ success: false, error: 'Δεν επιλέχθηκε αρχείο' }, 400)
    }

    const techIdRaw =
      String(form.get('techId') || form.get('tech_id') || '').trim() ||
      String(form.get('techName') || form.get('tech_name') || '').trim()
    const techPart = sanitizeSegment(techIdRaw, 'unknown')

    const mime = file.type || 'image/jpeg'
    const ext = extensionForMime(mime)
    const uuid = crypto.randomUUID().replace(/-/g, '')
    const timestamp = Date.now()
    const objectKey = `personnel/profile/${techPart}/${timestamp}-${uuid}.${ext}`

    const buffer = new Uint8Array(await file.arrayBuffer())
    const client = getR2Client()

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: mime,
      }),
    )

    const url = publicUrlForKey(objectKey)
    return jsonResponse({ success: true, url, objectKey })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ success: false, error: message }, 400)
  }
})
