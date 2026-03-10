import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

export default function handler() {
  const labs = [
    { name: "OpenAI", color: "#10a37f" },
    { name: "Anthropic", color: "#d4a574" },
    { name: "Google", color: "#4285f4" },
    { name: "xAI", color: "#ef4444" },
    { name: "Chinese Labs", color: "#a855f7" },
  ];

  return new ImageResponse(
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          width: "100%",
          height: "100%",
          backgroundColor: "#0f1117",
          padding: "60px 80px",
        },
        children: [
          // Rising lines SVG
          {
            type: "svg",
            props: {
              width: "600",
              height: "200",
              viewBox: "0 0 600 200",
              style: { position: "absolute", top: "80px", right: "80px", opacity: 0.25 },
              children: [
                {
                  type: "polyline",
                  props: {
                    points: "0,180 120,140 240,90 360,50 480,25 600,10",
                    fill: "none",
                    stroke: "#6c9eff",
                    "stroke-width": "4",
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round",
                  },
                },
                {
                  type: "polyline",
                  props: {
                    points: "0,190 120,160 240,140 360,100 480,70 600,45",
                    fill: "none",
                    stroke: "#10b981",
                    "stroke-width": "3.5",
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round",
                    opacity: "0.7",
                  },
                },
                {
                  type: "polyline",
                  props: {
                    points: "0,195 120,180 240,165 360,140 480,115 600,85",
                    fill: "none",
                    stroke: "#f59e0b",
                    "stroke-width": "3",
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round",
                    opacity: "0.5",
                  },
                },
              ],
            },
          },
          // Title block
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                zIndex: 1,
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: "72px",
                      fontWeight: "bold",
                      color: "#e8eaed",
                      letterSpacing: "-1px",
                      marginBottom: "20px",
                    },
                    children: "The AI Race",
                  },
                },
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: "28px",
                      color: "#9aa0a6",
                      textAlign: "center",
                      maxWidth: "800px",
                      lineHeight: "1.4",
                    },
                    children: "Up-to-date charts & AI commentary, to feed your latest FOMO pitch",
                  },
                },
              ],
            },
          },
          // Lab pills
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                gap: "16px",
                marginTop: "48px",
                zIndex: 1,
              },
              children: labs.map((lab) => ({
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 18px",
                    borderRadius: "20px",
                    border: "1px solid " + lab.color + "44",
                    backgroundColor: lab.color + "15",
                  },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          backgroundColor: lab.color,
                        },
                      },
                    },
                    {
                      type: "span",
                      props: {
                        style: { color: "#9aa0a6", fontSize: "18px" },
                        children: lab.name,
                      },
                    },
                  ],
                },
              })),
            },
          },
          // URL footer
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                bottom: "40px",
                color: "#808690",
                fontSize: "20px",
              },
              children: "ai-race.vercel.app",
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
    }
  );
}
