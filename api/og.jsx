import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

export default function handler() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          width: "100%",
          height: "100%",
          backgroundColor: "#0f1117",
          padding: "60px 80px",
        }}
      >
        {/* Rising lines — matches favicon aesthetic */}
        <svg
          width="600"
          height="200"
          viewBox="0 0 600 200"
          style={{ position: "absolute", top: "80px", right: "80px", opacity: 0.25 }}
        >
          <polyline
            points="0,180 120,140 240,90 360,50 480,25 600,10"
            fill="none"
            stroke="#6c9eff"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="0,190 120,160 240,140 360,100 480,70 600,45"
            fill="none"
            stroke="#10b981"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.7"
          />
          <polyline
            points="0,195 120,180 240,165 360,140 480,115 600,85"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.5"
          />
        </svg>

        {/* Title */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontSize: "72px",
              fontWeight: "bold",
              color: "#e8eaed",
              letterSpacing: "-1px",
              marginBottom: "20px",
            }}
          >
            The AI Race
          </div>
          <div
            style={{
              fontSize: "28px",
              color: "#9aa0a6",
              textAlign: "center",
              maxWidth: "800px",
              lineHeight: "1.4",
            }}
          >
            Benchmark scores & API costs across frontier AI labs, updated quarterly.
          </div>
        </div>

        {/* Lab pills */}
        <div
          style={{
            display: "flex",
            gap: "16px",
            marginTop: "48px",
            zIndex: 1,
          }}
        >
          {[
            { name: "OpenAI", color: "#10a37f" },
            { name: "Anthropic", color: "#d4a574" },
            { name: "Google", color: "#4285f4" },
            { name: "xAI", color: "#ef4444" },
            { name: "Chinese Labs", color: "#a855f7" },
          ].map((lab) => (
            <div
              key={lab.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 18px",
                borderRadius: "20px",
                border: `1px solid ${lab.color}44`,
                backgroundColor: `${lab.color}15`,
              }}
            >
              <div
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  backgroundColor: lab.color,
                }}
              />
              <span style={{ color: "#9aa0a6", fontSize: "18px" }}>
                {lab.name}
              </span>
            </div>
          ))}
        </div>

        {/* URL */}
        <div
          style={{
            position: "absolute",
            bottom: "40px",
            color: "#5f6368",
            fontSize: "20px",
          }}
        >
          ai-race.vercel.app
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
