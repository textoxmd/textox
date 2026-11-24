export interface PicgoUploadResponse {
  success: boolean;
  result: string[];
  message?: string;
}

function uploadUrl(serverUrl: string): string {
  return new URL('/upload', serverUrl).toString();
}

/** 调 PicGo Server 上传本地图片，返回远端 URL。 */
export async function uploadViaPicgo(imagePath: string, serverUrl: string): Promise<string> {
  const res = await fetch(uploadUrl(serverUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ list: [imagePath] }),
  });
  if (!res.ok) throw new Error(`PicGo server returned ${res.status}`);
  const data: PicgoUploadResponse = await res.json();
  if (!data.success) throw new Error(data.message || 'Upload failed');
  if (!data.result?.length) throw new Error('PicGo returned no result');
  const first = data.result[0];
  if (typeof first !== 'string' || !first) throw new Error('PicGo returned an invalid result');
  return first;
}
