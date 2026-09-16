# BitTrace Investigator

Build a professional, hackathon-ready offline Bitcoin Transaction Traffic Monitoring & Analysis platform for an investigation/forensics use case.

1. Product Name

BitTrace AI

Tagline:
AI-Powered Bitcoin Transaction Traffic Monitoring & Analysis

The application should look like a serious cybersecurity / blockchain-forensics investigation platform, NOT a crypto trading website.

2. Core Objective

Build a complete prototype that ingests a synthetic Bitcoin transaction/network metadata dataset and:

Ingests CSV / JSON / XML files

Parses Bitcoin transaction and network metadata

Correlates:

IP addresses

Ports

timestamps

TXIDs

wallet addresses

input/output addresses

transaction amounts

fees

script types

country / ASN

Creates an interactive entity/transaction graph

Uses AI/ML to detect suspicious/anomalous activity

Clusters related wallets/entities

Generates prioritized investigation alerts

Provides explainable reasons for every alert

Shows a confidence/anomaly score

Provides a dashboard for investigators

The prototype must work with local synthetic data and should be designed so that the ML backend can later be connected to a Python/FastAPI service.

3. Important Requirement

This is NOT a cryptocurrency price tracker.

Do NOT include:

Bitcoin price charts

trading functionality

buy/sell buttons

exchange UI

portfolio tracking

wallet investment features

The application is specifically for:

Blockchain forensics + network traffic analysis + anomaly detection + entity investigation.

4. Overall UI

Create a dark cybersecurity dashboard.

Visual style:

Dark navy/black background

Professional SOC/cybersecurity aesthetic

Blue/cyan accent colors

Red/orange for high-risk alerts

Green for low-risk/normal activity

Glass/modern cards

Subtle borders

Clean typography

Minimal animations

Dense but readable investigative information

The application should feel similar to:

Security Operations Center dashboard

Digital forensics platform

Link-analysis investigation software

Do NOT make it look like a gaming dashboard.

5. Main Navigation

Create a left sidebar with:

BITTRACE AI

Navigation:

Dashboard

Data Ingestion

Transaction Explorer

Entity Graph

AI Anomaly Detection

Entity Clusters

Investigation Alerts

Geo Network

Reports

Settings

At the bottom show:

SYSTEM STATUS
● Offline Analysis Mode

6. DASHBOARD

Create an investigator-focused dashboard.

Top KPI cards:

Total Transactions

Example:
24,581

Wallet Entities

Example:
8,942

Network IPs

Example:
3,216

Suspicious Entities

Example:
184

High-Risk Alerts

Example:
37

Average Anomaly Score

Example:
0.67

Add a small label:

Synthetic Dataset

Dashboard Charts

A. Transaction Activity Over Time

Interactive line/area chart showing:

Normal transactions

Suspicious transactions

X-axis:
Timestamp

Y-axis:
Transaction count

B. Risk Distribution

Donut chart:

Low

Medium

High

Critical

C. Suspicious Activity Types

Bar chart:

Rapid wallet movement

Unusual transaction amount

High-degree wallet

IP-wallet correlation anomaly

Layering pattern

Entity cluster anomaly

Geographic anomaly

D. Top Suspicious Entities

Table:

Entity

Type

Risk

Score

Reason

wallet_1

Wallet

Critical

0.96

Rapid fund movement

wallet_2

Wallet

High

0.89

Unusual transaction pattern

IP_23

IP

High

0.86

Linked to multiple wallets

Clicking a row should open the investigation view.

7. DATA INGESTION PAGE

Create a large drag-and-drop upload area.

Title:

Import Investigation Dataset

Supported formats:

CSV

JSON

XML

Show:

Offline processing — files remain on the local system

After upload, show:

Dataset Summary

File name

File type

Number of records

Number of wallets

Number of transactions

Number of IP addresses

Date range

Then show a preview table.

Expected fields:

timestamp
src_ip
dst_ip
src_port
dst_port
txid
input_addresses
output_addresses
input_amounts
output_amounts
fee
script_type
geo_country
asn

Add:



Run Analysis



button.



When clicked, show a processing pipeline:

Dataset Loaded
      ↓
Schema Validation
      ↓
Data Cleaning
      ↓
Transaction Parsing
      ↓
IP ↔ Wallet Correlation
      ↓
Feature Engineering
      ↓
ML Anomaly Detection
      ↓
Entity Clustering
      ↓
Explainable Risk Scoring
      ↓
Investigation Alerts

8. TRANSACTION EXPLORER

Create a searchable transaction table.

Columns:

TXID

Timestamp

Input Wallets

Output Wallets

Input Amount

Output Amount

Fee

Source IP

Destination IP

Country

ASN

Risk Score

Status

Allow filtering by:

Risk

Country

ASN

Amount

Date

IP

Wallet

Script type

Clicking a TXID opens a detailed transaction page.

9. TRANSACTION DETAIL

Create a professional investigation page.

Header:

Transaction Investigation

Display:

TXID

Timestamp

Risk Score

Risk Level

Transaction Flow

Create a visual flow:

SOURCE WALLET
     ↓
TRANSACTION
     ↓
DESTINATION WALLET

Show:

Input addresses

Output addresses

Input amount

Output amount

Fee

Script type

Network Information

Show:

Source IP
Destination IP
Source Port
Destination Port
Country
ASN

AI Explanation

Create a card:

Why was this transaction flagged?

Example:

High anomaly score because the transaction shows unusually rapid fund movement, connects to multiple wallet entities, and deviates significantly from the normal transaction amount distribution.

Show feature contributions:

Rapid fund movement        +0.24
Wallet connectivity        +0.21
Amount anomaly             +0.18
IP correlation             +0.13
Geographic deviation       +0.09

Use horizontal bars.

10. ENTITY GRAPH

This is one of the most important pages.

Create a large interactive graph visualization.

Nodes:

Wallet

Blue circular node

Transaction

Purple square node

IP

Orange node

ASN

Green node

Edges:

Wallet → Transaction

Transaction → Wallet

IP → Transaction

IP → Wallet

IP → ASN

Example:

       IP
       |
       |
     TX123
    /     \
Wallet A  Wallet B
    |
   TX456
    |
Wallet C

Node size should depend on connectivity.

Suspicious nodes should visually stand out.

Clicking a node should open an investigation side panel.

11. ENTITY INVESTIGATION PANEL

When clicking a wallet:

Show:

Wallet Information

Wallet ID / Address

Risk Score

Risk Level

First Seen

Last Seen

Transaction Count

Incoming Volume

Outgoing Volume

Connected IPs

Connected Wallets

Connected Transactions

AI Risk Explanation

Example:

Risk Score: 91/100

Reasons:

Connected to 27 wallet entities

Unusual outgoing transaction frequency

High transaction-volume deviation

Associated with multiple network endpoints

Strong similarity with suspicious entity cluster

Connected Entities

Show a small table:

Entity

Type

Connections

Risk

IP-192

IP

12

High

Wallet-B

Wallet

8

Medium

TX-918

Transaction

1

High

12. AI ANOMALY DETECTION

Create a dedicated ML analysis page.

Header:

AI-Powered Anomaly Detection

Explain:

Machine learning identifies transaction and entity behavior that deviates from learned normal patterns. The system combines transaction, network, temporal and graph-derived features to prioritize investigative leads.

Show model information:

Model

Isolation Forest

Purpose:

Unsupervised anomaly detection

Because the provided dataset is synthetic and does not necessarily contain reliable labels.

Feature Engineering

Display features used by the model:

Transaction amount

Fee ratio

Input/output count

Transaction frequency

Time between transactions

Wallet degree

IP degree

Number of connected wallets

Number of connected IPs

Geographic diversity

ASN diversity

Incoming/outgoing volume

Burst activity

Repeated IP-wallet relationships

Model Output

Create an anomaly score from:

0.00 → 1.00

Risk mapping:

0.00–0.39   Low
0.40–0.69   Medium
0.70–0.89   High
0.90–1.00   Critical

Make it clear that this is an investigative prioritization score, not proof of criminal activity.

13. ENTITY CLUSTERING

Create a page:

Suspicious Entity Clusters

Use clustering visualization.

Example clusters:

Cluster #01
23 wallets
8 IPs
41 transactions
Risk: High

Cluster #02
17 wallets
5 IPs
29 transactions
Risk: Medium

Possible algorithm:

DBSCAN

Features can include:

transaction behavior

connectivity

transaction frequency

amount patterns

IP relationships

Show each cluster as a card.

Clicking a cluster opens its graph.

14. INVESTIGATION ALERTS

Create the main alert-management page.

Header:

Prioritized Investigation Leads

Table:

Priority

Entity

Type

Risk

Confidence

Detection Reason

Status

Example:

CRITICAL
Wallet A
Wallet
0.94
0.92
Unusual transaction burst + high graph connectivity
New

Statuses:

New

Investigating

Reviewed

Dismissed

Allow sorting by:

Risk

Confidence

Timestamp

Entity type

15. EXPLAINABLE ALERT DETAILS

Clicking an alert opens a right-side investigation drawer.

Show:

Alert

Suspicious Wallet Entity

Confidence

92%

Anomaly Score

94%

Detection Factors

Transaction burst

High wallet connectivity

Unusual amount pattern

Multiple IP associations

Geographic diversity

Show an explanation:

The entity was prioritized because its observed behavior differs substantially from the learned baseline. The strongest contributing signals were transaction frequency, graph connectivity and transaction amount deviation.

Then show:

Evidence

TXIDs

timestamps

wallet addresses

IP addresses

transaction amounts

linked entities

Add:

Open in Graph

button.

16. GEO NETWORK

Create a geographic visualization.

Use country-level visualization rather than precise real-world user tracking.

Show:

Country

Number of IPs

Number of transactions

Number of wallet associations

Risk level

Example:

India       1,240 IPs
US            842 IPs
Germany       321 IPs
Singapore     184 IPs

Add filters:

Country

Risk

Date

ASN

Do not imply that a country itself is suspicious.

17. REPORTS

Create a report generation page.

Show:

Generate Investigation Report

Report should include:

Dataset summary

Analysis period

Total transactions

Wallet entities

IP entities

Suspicious entities

Alert statistics

Top investigation leads

Graph relationships

AI model used

Feature explanations

Limitations

Buttons:

Export PDF

Export JSON

Export CSV

18. BACKEND-READY ARCHITECTURE

Build the frontend so it can later communicate with a Python FastAPI backend.

Create a clean API service layer.

Expected endpoints:

POST /api/upload
POST /api/analyze
GET  /api/dashboard
GET  /api/transactions
GET  /api/transactions/{txid}
GET  /api/entities
GET  /api/entities/{id}
GET  /api/graph
GET  /api/alerts
GET  /api/clusters
GET  /api/geo
GET  /api/reports

For the initial prototype, use realistic mock data if the backend is not connected.

Keep the API service layer separate so mock data can later be replaced with FastAPI endpoints without redesigning the UI.

19. DATA MODEL

Use these conceptual entities:

Transaction

txid
timestamp
input_addresses
output_addresses
input_amounts
output_amounts
fee
script_type

Network Observation

timestamp
src_ip
dst_ip
src_port
dst_port
txid

Geographic Metadata

ip
country
asn

Entity

id
type
risk_score
anomaly_score
connections

Alert

id
entity_id
entity_type
risk_level
confidence
anomaly_score
reasons
evidence
timestamp
status

20. MOCK DATA

Generate realistic synthetic mock data for the UI.

At minimum create:

500+ transactions

200+ wallets

100+ IP addresses

Multiple countries

Multiple ASNs

Normal and anomalous behavior

Wallet clusters

IP-wallet relationships

High-frequency transaction bursts

Unusual transaction amounts

Clearly label all mock information:

SYNTHETIC DATA

Do not use real criminal identities or real seized Bitcoin data.

21. IMPORTANT ML DESIGN

The frontend should represent a real ML pipeline rather than pretending that static rules are AI.

The intended backend architecture is:

CSV / JSON / XML
       ↓
Pandas
       ↓
Data Cleaning
       ↓
Feature Engineering
       ↓
Isolation Forest
       ↓
DBSCAN / Entity Clustering
       ↓
Graph Construction
       ↓
Risk Scoring
       ↓
Explainability
       ↓
Dashboard

For explainability, show feature contributions / reason codes generated from the model features.

The UI should never claim:

“this wallet is definitely criminal.”

Instead use language such as:

Suspicious pattern

Anomalous behavior

Investigation lead

Elevated risk

Requires review

AI-prioritized entity

22. SEARCH

Add a global search bar.

Placeholder:

Search TXID, wallet, IP, ASN…

Search results should categorize matches:

Transactions
Wallets
IP Addresses
Clusters
Alerts

23. INTERACTION REQUIREMENTS

Make the prototype highly interactive.

Required interactions:

Upload dataset

Run analysis

Search TXID/wallet/IP

Filter alerts

Sort alerts

Click transaction

Click wallet

Click IP

Expand investigation details

Explore graph

Open connected entities

Filter graph

Change date range

View alert evidence

Generate report

Use smooth transitions but keep the application professional.

24. EMPTY / LOADING STATES

Create professional states.

Before dataset upload:

No investigation dataset loaded

“Upload a CSV, JSON or XML dataset to begin offline analysis.”

During analysis:

Running AI Analysis…

Show the processing pipeline with progress.

After analysis:

Analysis Complete

“24,581 records processed successfully.”

25. SECURITY / PRIVACY

Add a small footer:

Offline Analysis Mode • Synthetic Dataset • No Live Blockchain Monitoring

Do not include external wallet tracking or live blockchain APIs in the prototype.

The purpose is offline analysis of provided datasets.

26. TECH STACK

Use:

Frontend:

React

TypeScript

Tailwind CSS

Recharts

Lucide icons

For graph visualization use a suitable React graph library such as:

React Flow
OR

Cytoscape.js

Use reusable components and clean folder structure.

Prepare the frontend for:

React → FastAPI → Python ML pipeline

27. DESIGN DETAILS

Use responsive desktop-first layout.

The main dashboard should have:

Left:
Sidebar

Top:
Search + system status + profile/settings

Center:
KPIs + charts

Bottom:
Suspicious entities + investigation alerts

Use cards with enough padding.

Do not overcrowd cards with paragraphs.

Use:

short labels

numbers

badges

icons

charts

tables

expandable panels

28. DEMO FLOW

The complete demo should work like this:

Step 1

User opens BitTrace AI.

Step 2

Dashboard displays:

No dataset loaded

Step 3

User opens Data Ingestion.

Step 4

Uploads:

bitcoin_network_metadata.csv

Step 5

System validates the schema.

Step 6

User clicks:

Run AI Analysis

Step 7

Show processing pipeline.

Step 8

Dashboard becomes populated.

Step 9

User sees:

transaction statistics

anomaly statistics

suspicious entities

clusters

geographic relationships

Step 10

User clicks a high-risk alert.

Step 11

Investigation panel shows:

entity

risk score

confidence

explanation

evidence

connected transactions

connected IPs

Step 12

User clicks:

Open in Graph

Step 13

Interactive graph shows:

IP → Transaction → Wallet → Transaction → Wallet

This should be the main “wow” moment of the prototype.

29. FINAL QUALITY REQUIREMENT

Make this look like a real cybersecurity investigation product suitable for a national-level hackathon demonstration.

Prioritize:

Working data ingestion UI

AI anomaly detection visualization

Explainable alerts

Interactive entity graph

Transaction investigation

Entity clustering

Clean dashboard

Backend-ready architecture

The application should demonstrate the complete story:

Raw Metadata → Correlation → AI/ML → Graph → Anomaly → Explainable Alert → Investigation Lead

Do not build only a static dashboard. Build a believable end-to-end prototype experience.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/2a729198-3161-43ef-8548-78e4c666c0a2).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
