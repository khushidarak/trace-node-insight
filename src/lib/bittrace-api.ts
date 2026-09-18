export type RiskLevel = "Low" | "Medium" | "High" | "Critical";
export type EntityType = "Wallet" | "IP" | "Transaction" | "ASN";
export type AlertStatus = "New" | "Investigating" | "Reviewed" | "Dismissed";

export interface Transaction {
  txid: string;
  timestamp: string;
  inputAddresses: string[];
  outputAddresses: string[];
  inputAmount: number;
  outputAmount: number;
  fee: number;
  scriptType: string;
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  country: string;
  asn: string;
  riskScore: number;
  risk: RiskLevel;
  status: "Normal" | "Flagged";
}

export interface Entity {
  id: string;
  type: EntityType;
  riskScore: number;
  anomalyScore: number;
  connections: number;
  reason: string;
  firstSeen: string;
  lastSeen: string;
}

export interface Alert {
  id: string;
  entityId: string;
  entityType: EntityType;
  risk: RiskLevel;
  confidence: number;
  anomalyScore: number;
  reasons: string[];
  evidence: string[];
  timestamp: string;
  status: AlertStatus;
}

export interface Cluster {
  id: string;
  wallets: number;
  ips: number;
  transactions: number;
  risk: RiskLevel;
  score: number;
  signature: string;
  countries: string[];
}

const countries = [
  "India",
  "United States",
  "Germany",
  "Singapore",
  "Netherlands",
  "Japan",
  "Canada",
];
const scripts = ["P2WPKH", "P2SH", "P2PKH", "P2TR", "Multisig"];
const asns = ["AS4755", "AS7922", "AS3320", "AS9506", "AS45102", "AS16509", "AS13335"];
const pad = (value: number, length = 4) => value.toString(16).padStart(length, "0");
const wallet = (value: number) => `bc1q${pad(value, 6)}${pad(value * 17 + 43, 6)}x`;
const ip = (value: number) =>
  `${103 + (value % 34)}.${18 + (value % 201)}.${10 + (value % 190)}.${4 + (value % 241)}`;
const dateFor = (index: number) => {
  const date = new Date(Date.UTC(2026, 2, 12, 7, 12, 0));
  date.setMinutes(date.getMinutes() + index * 41);
  return date.toISOString();
};
const riskFor = (score: number): RiskLevel =>
  score >= 0.9 ? "Critical" : score >= 0.7 ? "High" : score >= 0.4 ? "Medium" : "Low";

export const transactions: Transaction[] = Array.from({ length: 540 }, (_, index) => {
  const burst = index % 29 === 0 || index % 47 === 0;
  const amount = Number((0.02 + ((index * 37) % 900) / 1000 + (burst ? 4.2 : 0)).toFixed(4));
  const score = Number(
    Math.min(0.98, 0.12 + ((index * 19) % 69) / 100 + (burst ? 0.27 : 0)).toFixed(2),
  );
  return {
    txid: `${pad(index + 1, 4)}${pad(index * 71 + 912, 8)}${pad(index * 13 + 82, 6)}`,
    timestamp: dateFor(index),
    inputAddresses: [wallet(((index * 3) % 224) + 1)],
    outputAddresses: [
      wallet(((index * 7 + 9) % 224) + 1),
      ...(index % 5 === 0 ? [wallet(((index * 11 + 17) % 224) + 1)] : []),
    ],
    inputAmount: amount,
    outputAmount: Number((amount - 0.0001 - (index % 6) * 0.00003).toFixed(4)),
    fee: Number((0.0001 + (index % 14) * 0.00002).toFixed(5)),
    scriptType: scripts[index % scripts.length] ?? "P2WPKH",
    srcIp: ip(((index * 5) % 128) + 1),
    dstIp: ip(((index * 11) % 128) + 4),
    srcPort: 8333,
    dstPort: index % 8 === 0 ? 9050 : 8333,
    country: countries[index % countries.length] ?? "India",
    asn: asns[index % asns.length] ?? "AS4755",
    riskScore: score,
    risk: riskFor(score),
    status: score >= 0.7 ? "Flagged" : "Normal",
  };
});

export const entities: Entity[] = Array.from({ length: 240 }, (_, index) => {
  const score = Number(
    Math.min(0.98, 0.16 + ((index * 23) % 71) / 100 + (index % 31 === 0 ? 0.18 : 0)).toFixed(2),
  );
  return {
    id: index < 224 ? wallet(index + 1) : `IP_${index - 223}`,
    type: index < 224 ? "Wallet" : "IP",
    riskScore: Math.round(score * 100),
    anomalyScore: score,
    connections: 2 + ((index * 13) % 31),
    reason:
      index % 3 === 0
        ? "Rapid fund movement"
        : index % 3 === 1
          ? "Unusual transaction pattern"
          : "Linked to multiple wallets",
    firstSeen: "12 Mar 2026",
    lastSeen: "28 Mar 2026",
  };
});

export const alerts: Alert[] = [
  {
    id: "ALT-001",
    entityId: wallet(32),
    entityType: "Wallet",
    risk: "Critical",
    confidence: 0.92,
    anomalyScore: 0.96,
    reasons: [
      "Transaction burst",
      "High wallet connectivity",
      "Unusual amount pattern",
      "Multiple IP associations",
    ],
    evidence: [transactions[29]?.txid ?? "", transactions[58]?.txid ?? "", ip(24), ip(49)],
    timestamp: dateFor(58),
    status: "New",
  },
  {
    id: "ALT-002",
    entityId: wallet(77),
    entityType: "Wallet",
    risk: "High",
    confidence: 0.87,
    anomalyScore: 0.89,
    reasons: ["Rapid wallet movement", "Amount deviation", "Repeated IP-wallet relationship"],
    evidence: [transactions[76]?.txid ?? "", transactions[123]?.txid ?? "", ip(18)],
    timestamp: dateFor(123),
    status: "Investigating",
  },
  {
    id: "ALT-003",
    entityId: "IP_23",
    entityType: "IP",
    risk: "High",
    confidence: 0.83,
    anomalyScore: 0.86,
    reasons: ["Linked to multiple wallets", "ASN concentration", "Geographic deviation"],
    evidence: [transactions[88]?.txid ?? "", transactions[211]?.txid ?? "", "AS4755"],
    timestamp: dateFor(211),
    status: "New",
  },
  {
    id: "ALT-004",
    entityId: wallet(19),
    entityType: "Wallet",
    risk: "Medium",
    confidence: 0.71,
    anomalyScore: 0.71,
    reasons: ["Layering pattern", "Wallet degree increase"],
    evidence: [transactions[18]?.txid ?? "", transactions[41]?.txid ?? ""],
    timestamp: dateFor(41),
    status: "Reviewed",
  },
  {
    id: "ALT-005",
    entityId: wallet(118),
    entityType: "Wallet",
    risk: "Medium",
    confidence: 0.66,
    anomalyScore: 0.64,
    reasons: ["Fee ratio anomaly", "Burst activity"],
    evidence: [transactions[117]?.txid ?? ""],
    timestamp: dateFor(117),
    status: "New",
  },
];

export const clusters: Cluster[] = [
  {
    id: "Cluster #01",
    wallets: 23,
    ips: 8,
    transactions: 41,
    risk: "High",
    score: 0.88,
    signature: "Rapid movement + shared endpoints",
    countries: ["India", "Singapore"],
  },
  {
    id: "Cluster #02",
    wallets: 17,
    ips: 5,
    transactions: 29,
    risk: "Medium",
    score: 0.63,
    signature: "Repeated amount bands",
    countries: ["United States", "Canada"],
  },
  {
    id: "Cluster #03",
    wallets: 31,
    ips: 11,
    transactions: 74,
    risk: "Critical",
    score: 0.94,
    signature: "Layering + high-degree hub",
    countries: ["Germany", "Netherlands", "Japan"],
  },
  {
    id: "Cluster #04",
    wallets: 12,
    ips: 4,
    transactions: 18,
    risk: "Low",
    score: 0.31,
    signature: "Stable cadence",
    countries: ["Canada"],
  },
];

export const activity = Array.from({ length: 16 }, (_, index) => ({
  day: `${12 + index} Mar`,
  normal: 720 + ((index * 131) % 520),
  suspicious: 60 + ((index * 37) % 180) + (index === 7 || index === 12 ? 170 : 0),
}));

export const activityTypes = [
  { name: "Rapid wallet movement", value: 312 },
  { name: "Unusual transaction amount", value: 248 },
  { name: "High-degree wallet", value: 189 },
  { name: "IP-wallet correlation", value: 154 },
  { name: "Layering pattern", value: 97 },
  { name: "Geographic anomaly", value: 61 },
];

export const riskDistribution = [
  { name: "Low", value: 70 },
  { name: "Medium", value: 46 },
  { name: "High", value: 41 },
  { name: "Critical", value: 27 },
];

export const geo = countries.map((country, index) => ({
  country,
  ips: [1240, 842, 321, 184, 143, 97, 78][index],
  transactions: [6240, 4210, 2014, 1280, 940, 712, 488][index],
  wallets: [1820, 1290, 620, 388, 240, 187, 122][index],
  risk: (["High", "Medium", "Medium", "Low", "Low", "Low", "Low"] as RiskLevel[])[index],
}));

export const findTransaction = (txid: string) =>
  transactions.find((item) => item.txid === txid) ?? transactions[29];
export const findEntity = (id: string) => entities.find((item) => item.id === id) ?? entities[31];
