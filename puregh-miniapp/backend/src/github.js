import config from './config.js';

const GH = 'https://api.github.com';
const headers = {
  accept: 'application/vnd.github+json',
  'user-agent': 'puregh-miniapp',
  ...(config.githubToken ? { authorization: `Bearer ${config.githubToken}` } : {}),
};

export async function getRepoMetadata(fullName) {
  const res = await fetch(`${GH}/repos/${fullName}`, { headers });
  if (res.status === 404) throw new Error('ریپو پیدا نشد');
  if (!res.ok) throw new Error(`github: ${res.status}`);
  return res.json();
}

export async function getReadmeRaw(fullName, defaultBranch) {
  // raw.githubusercontent avoids the GitHub API rate limit entirely
  // (same trick as the discovery workflow — no credential burned).
  const url = `https://raw.githubusercontent.com/${fullName}/${defaultBranch}/README.md`;
  const res = await fetch(url, { headers: { 'user-agent': 'puregh-miniapp' } });
  if (!res.ok) return '';
  return await res.text();
}