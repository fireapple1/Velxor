import {
  LayoutDashboard,
  Activity,
  ShieldAlert,
  Clock3,
  Settings,
} from "lucide-react";

export function Sidebar() {
  const items = [
    {
      label: "Dashboard",
      icon: LayoutDashboard,
    },
    {
      label: "Processes",
      icon: Activity,
    },
    {
      label: "Threats",
      icon: ShieldAlert,
    },
    {
      label: "Timeline",
      icon: Clock3,
    },
    {
      label: "Settings",
      icon: Settings,
    },
  ];

  return (
    <div
      style={{
        width: 76,

        background: "#0F141B",

        borderRight: "1px solid #1E2936",

        display: "flex",
        flexDirection: "column",

        alignItems: "center",

        paddingTop: 18,

        gap: 12,

        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div
        style={{
          width: 48,
          height: 48,

          borderRadius: 14,

          background:
            "linear-gradient(180deg, #161B22 0%, #121821 100%)",

          border: "1px solid #1E2936",

          display: "flex",
          alignItems: "center",
          justifyContent: "center",

          color: "#E6EDF3",

          fontWeight: 800,

          fontSize: 18,

          letterSpacing: 1,

          marginBottom: 20,

          boxShadow:
            "0 4px 12px rgba(0,0,0,0.22)",
        }}
      >
        V
      </div>

      {/* Menu */}
      {items.map((item, index) => {
        const Icon = item.icon;

        const active = index === 0;

        return (
          <button
            key={item.label}
            title={item.label}
            style={{
              width: 48,
              height: 48,

              borderRadius: 14,

              border: active
                ? "1px solid #30363D"
                : "1px solid transparent",

              background: active
                ? "#161B22"
                : "transparent",

              color: active
                ? "#E6EDF3"
                : "#8B949E",

              cursor: "pointer",

              display: "flex",
              alignItems: "center",
              justifyContent: "center",

              transition:
                "background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.15s ease",

              boxShadow: active
                ? "inset 0 1px 0 rgba(255,255,255,0.03)"
                : "none",

              outline: "none",
            }}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.background =
                  "#121821";

                e.currentTarget.style.color =
                  "#E6EDF3";
              }

              e.currentTarget.style.transform =
                "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.background =
                  "transparent";

                e.currentTarget.style.color =
                  "#8B949E";
              }

              e.currentTarget.style.transform =
                "translateY(0px)";
            }}
          >
            <Icon
              size={19}
              strokeWidth={2.2}
            />
          </button>
        );
      })}

      {/* Bottom status */}
      <div
        style={{
          marginTop: "auto",

          marginBottom: 16,

          display: "flex",
          flexDirection: "column",
          alignItems: "center",

          gap: 8,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,

            borderRadius: 999,

            background: "#2EA043",

            boxShadow:
              "0 0 8px rgba(46,160,67,0.45)",
          }}
        />

        <div
          style={{
            fontSize: 10,

            color: "#6E7681",

            letterSpacing: 0.5,
          }}
        >
          ONLINE
        </div>
      </div>
    </div>
  );
}