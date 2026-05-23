export function Sidebar() {
  const items = [
    "Dashboard",
    "Processes",
    "Threats",
    "Timeline",
    "Settings",
  ];

  return (
    <div
      style={{
        width: 72,
        background: "#0F141B",
        borderRight: "1px solid #1E2936",

        display: "flex",
        flexDirection: "column",
        alignItems: "center",

        paddingTop: 16,
        gap: 12,
      }}
    >
      {items.map((item) => (
        <button
          key={item}
          style={{
            width: 48,
            height: 48,

            borderRadius: 12,
            border: "1px solid transparent",

            background: "transparent",
            color: "#8B949E",

            cursor: "pointer",
          }}
        >
          {item[0]}
        </button>
      ))}
    </div>
  );
}