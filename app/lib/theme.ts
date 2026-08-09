/// Collection-specific branding for the standalone NFTfax office.
///
/// All values are driven by NEXT_PUBLIC_ env vars so a deploy can be reskinned
/// (Dead Fellaz, Chonks, etc.) without touching code. Drop the background image
/// into `public/` and point `NEXT_PUBLIC_FAX_BACKGROUND_IMAGE` at it.

export type CollectionKey = 'chonk' | 'deadfellaz' | 'normie' | 'pow';

export interface FaxTheme {
  key: CollectionKey;
  siteName: string;
  tagline: string;
  fromDomain: 'fax' | 'nftmail.box';
  mailboxPlaceholder: string;
  mailboxHint: string;
  backgroundImage: string | null;
  backgroundOpacity: number;
  accent: string;
  primaryButton: string;
  collectionName: string;
  contract: string;
  chainId: number;
  rpc: string;
}

function getEnv(key: string, fallback: string): string {
  if (typeof process === 'undefined') return fallback;
  return process.env[`NEXT_PUBLIC_${key}`] ?? fallback;
}

function getNumericEnv(key: string, fallback: number): number {
  const raw = getEnv(key, String(fallback));
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/// Default fallbacks for the three fax chain-letter games.
const COLLECTIONS: Record<CollectionKey, Partial<FaxTheme>> = {
  chonk: {
    siteName: 'CHONKFAX',
    tagline: 'Base chain letter',
    mailboxPlaceholder: 'chonk.1234',
    mailboxHint: 'chonk.1234',
    collectionName: 'Chonks',
    contract: '0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9',
    chainId: 8453,
    rpc: 'https://mainnet.base.org',
  },
  deadfellaz: {
    siteName: 'DEADFELLAZFAX',
    tagline: 'Ethereum chain letter',
    mailboxPlaceholder: 'dfz.1234',
    mailboxHint: 'dfz.1234',
    collectionName: 'Dead Fellaz',
    contract: '0x2acab3dea77832c09420663b0e1cb386031ba17b',
    chainId: 1,
    rpc: 'https://ethereum-rpc.publicnode.com',
  },
  normie: {
    siteName: 'NORMIEFAX',
    tagline: '40 x 40 chain letter',
    mailboxPlaceholder: 'normie.1234',
    mailboxHint: 'normie.1234',
    collectionName: 'Normies',
    contract: '0x9eb6e2025b64f340691e424b7fe7022ffde12438',
    chainId: 1,
    rpc: 'https://ethereum-rpc.publicnode.com',
  },
  pow: {
    siteName: 'POWFAX',
    tagline: 'Proof of Work chain letter',
    mailboxPlaceholder: 'atom.1234',
    mailboxHint: 'atom.1234',
    collectionName: 'POW NFT',
    contract: '0x9abb7bddc43fa67c76a62d8c016513827f59be1b',
    chainId: 1,
    rpc: 'https://ethereum-rpc.publicnode.com',
  },
};

function baseTheme(): Omit<FaxTheme, 'key'> & { key: CollectionKey } {
  return {
    key: 'deadfellaz',
    siteName: getEnv('FAX_SITE_NAME', 'NFTFAX'),
    tagline: getEnv('FAX_TAGLINE', 'Internet document transmission office'),
    fromDomain: (getEnv('FAX_FROM_DOMAIN', 'fax') as 'fax' | 'nftmail.box') === 'nftmail.box' ? 'nftmail.box' : 'fax',
    mailboxPlaceholder: getEnv('FAX_MAILBOX_PLACEHOLDER', 'dfz.1234'),
    mailboxHint: getEnv('FAX_MAILBOX_HINT', 'dfz.1234'),
    backgroundImage: getEnv('FAX_BACKGROUND_IMAGE', '') || null,
    backgroundOpacity: Math.max(0, Math.min(1, getNumericEnv('FAX_BACKGROUND_OPACITY', 0.25))),
    accent: getEnv('FAX_ACCENT', '#e65b2f'),
    primaryButton: getEnv('FAX_PRIMARY_BUTTON', '#e65b2f'),
    collectionName: getEnv('FAX_COLLECTION_NAME', 'Dead Fellaz'),
    contract: getEnv('FAX_COLLECTION_CONTRACT', '0x2acab3dea77832c09420663b0e1cb386031ba17b'),
    chainId: Number(getEnv('FAX_CHAIN_ID', '1')) || 1,
    rpc: getEnv('FAX_RPC', 'https://ethereum-rpc.publicnode.com'),
  };
}

export function getCollectionTheme(key: CollectionKey): Readonly<FaxTheme> {
  const fallback = baseTheme();
  const override = COLLECTIONS[key] ?? {};
  return { ...fallback, ...override, key } as Readonly<FaxTheme>;
}

const rawDefault = getEnv('FAX_DEFAULT_COLLECTION', 'deadfellaz') as CollectionKey;
export const FAX_THEME = getCollectionTheme(COLLECTIONS[rawDefault] ? rawDefault : 'deadfellaz');

export function backgroundStyle(theme: Pick<FaxTheme, 'backgroundImage' | 'backgroundOpacity'>) {
  const src = theme.backgroundImage ?? null;
  const op = theme.backgroundOpacity;
  if (!src) return undefined;
  return {
    backgroundImage: `url(${src})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    opacity: op,
  };
}
