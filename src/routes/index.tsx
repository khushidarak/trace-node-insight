import { createFileRoute } from "@tanstack/react-router";
import { BitTraceApp } from "@/components/bittrace/BitTraceApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BitTrace AI — Bitcoin Forensics Console" },
      {
        name: "description",
        content:
          "Offline Bitcoin transaction traffic monitoring, anomaly detection, graph analysis, and explainable investigation leads.",
      },
      { property: "og:title", content: "BitTrace AI — Bitcoin Forensics Console" },
      {
        property: "og:description",
        content:
          "Offline Bitcoin transaction traffic monitoring, anomaly detection, graph analysis, and explainable investigation leads.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BitTraceApp,
});
