const socket = new WebSocket("ws://localhost:3000");

socket.addEventListener("open", (event) => {
  console.log("[TestClient] Connected to server!");

  // Subscribe using the same parameters as findMatchInDailyData
  const subscribeMsg = {
    action: "subscribe",
    args: {
      p1: "Pavel Vinansky",
      p2: "Vojtech Molin",
      date: "2026-06-21"
    }
  };

  console.log("[TestClient] Sending:", subscribeMsg);
  socket.send(JSON.stringify(subscribeMsg));
});

socket.addEventListener("message", (event) => {
  try {
    const data = JSON.parse(event.data);

    if (data.type === "odds_update") {
      console.log(`\n[TestClient] 🔔 Live Odds Update for ${data.matchSlug}!`);

      const moneyline = data.odds.lines.find((l: any) => l.market === "one_two");
      if (moneyline) {
        console.log("  -> Moneyline (1x2):");
        moneyline.rates.forEach((rate: any) => {
          console.log(`     - ${rate.outcome}: ${rate.value}`);
        });
      } else {
        console.log("  -> Received update, but no moneyline found.");
      }
    } else {
      console.log("[TestClient] Received message:", data);
    }
  } catch (err) {
    console.log("[TestClient] Received raw text:", event.data);
  }
});

socket.addEventListener("close", () => {
  console.log("[TestClient] Disconnected from server.");
});
