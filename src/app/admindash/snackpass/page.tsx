"use client";

import { useEffect, useMemo, useState } from "react";

type MenuItem = {
  id: number;
  dish_slug: string;
  dish_name: string;
  restaurant_name: string;
  restaurant_address: string | null;
  base_price_cents: number;
  service_fee_cents: number | null;
  delivery_fee_cents: number | null;
  currency: string;
  is_active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type SnackpassOrder = {
  id: number;
  username: string;
  status: string;
  dish_name: string;
  restaurant_name: string;
  order_type: string;
  shipping_location: string;
  estimated_total: string | null;
  created_at: string;
  updated_at: string;
};

function toUsd(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

export default function SnackpassAdminPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<SnackpassOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    dishName: "",
    restaurantName: "",
    restaurantAddress: "",
    basePrice: "",
    serviceFee: "",
    deliveryFee: "",
    notes: "",
    isActive: true,
  });

  const canSubmit = useMemo(() => {
    return form.dishName.trim() && form.restaurantName.trim() && form.basePrice.trim();
  }, [form]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [menuRes, orderRes] = await Promise.all([
        fetch("/api/admin/snackpass/menu-items", { cache: "no-store" }),
        fetch("/api/admin/snackpass/orders", { cache: "no-store" }),
      ]);
      if (!menuRes.ok) throw new Error("Failed to load menu items");
      if (!orderRes.ok) throw new Error("Failed to load Snackpass orders");
      const menuData = await menuRes.json();
      const orderData = await orderRes.json();
      setItems(Array.isArray(menuData) ? menuData : []);
      setOrders(Array.isArray(orderData) ? orderData : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const basePriceCents = dollarsToCents(form.basePrice);
      if (basePriceCents == null) {
        throw new Error("Base price must be a valid number in dollars.");
      }
      const serviceFeeCents = dollarsToCents(form.serviceFee);
      const deliveryFeeCents = dollarsToCents(form.deliveryFee);

      const res = await fetch("/api/admin/snackpass/menu-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dish_name: form.dishName,
          restaurant_name: form.restaurantName,
          restaurant_address: form.restaurantAddress,
          base_price_cents: basePriceCents,
          service_fee_cents: serviceFeeCents,
          delivery_fee_cents: deliveryFeeCents,
          notes: form.notes,
          is_active: form.isActive,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Create failed");
      }
      setForm({
        dishName: "",
        restaurantName: "",
        restaurantAddress: "",
        basePrice: "",
        serviceFee: "",
        deliveryFee: "",
        notes: "",
        isActive: true,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(item: MenuItem) {
    try {
      const res = await fetch(`/api/admin/snackpass/menu-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: item.is_active === 1 ? false : true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Update failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleEditFees(item: MenuItem) {
    const base = prompt("Base price (USD)", (item.base_price_cents / 100).toFixed(2));
    if (base == null) return;
    const service = prompt("Service fee (USD, optional)", item.service_fee_cents != null ? (item.service_fee_cents / 100).toFixed(2) : "");
    if (service == null) return;
    const delivery = prompt("Delivery fee (USD, optional)", item.delivery_fee_cents != null ? (item.delivery_fee_cents / 100).toFixed(2) : "");
    if (delivery == null) return;

    const baseCents = dollarsToCents(base);
    if (baseCents == null) {
      setError("Base price must be a valid number in dollars.");
      return;
    }
    const serviceCents = dollarsToCents(service ?? "");
    const deliveryCents = dollarsToCents(delivery ?? "");

    try {
      const res = await fetch(`/api/admin/snackpass/menu-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_price_cents: baseCents,
          service_fee_cents: serviceCents,
          delivery_fee_cents: deliveryCents,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Update failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  if (loading) {
    return (
      <main style={{ padding: 48, textAlign: "center" }}>
        <p style={{ color: "var(--muted)" }}>Loading Snackpass menu…</p>
      </main>
    );
  }

  const openOrders = orders.filter((o) => o.status !== "Fulfilled" && o.status !== "Failed");
  const closedOrders = orders.filter((o) => o.status === "Fulfilled" || o.status === "Failed");

  return (
    <main
      style={{
        padding: "48px 24px",
        maxWidth: 1200,
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
        display: "block",
        overflow: "visible",
        position: "relative",
        zIndex: 1,
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Admin — Snackpass Menu</h1>
      <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 24 }}>
        Manage the curated Snackpass dish catalog used for order matching.
      </p>

      {error && (
        <div style={{ marginBottom: 16, color: "#b42318" }}>{error}</div>
      )}

      <section style={{ border: "1px solid var(--line)", background: "var(--paper)", padding: 20, marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>Add menu item</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <input
            placeholder="Dish name"
            value={form.dishName}
            onChange={(e) => setForm((prev) => ({ ...prev, dishName: e.target.value }))}
            style={{ padding: "10px 12px", border: "1px solid var(--line)" }}
          />
          <input
            placeholder="Restaurant name"
            value={form.restaurantName}
            onChange={(e) => setForm((prev) => ({ ...prev, restaurantName: e.target.value }))}
            style={{ padding: "10px 12px", border: "1px solid var(--line)" }}
          />
          <input
            placeholder="Restaurant address (optional)"
            value={form.restaurantAddress}
            onChange={(e) => setForm((prev) => ({ ...prev, restaurantAddress: e.target.value }))}
            style={{ padding: "10px 12px", border: "1px solid var(--line)" }}
          />
          <input
            placeholder="Base price (USD)"
            value={form.basePrice}
            onChange={(e) => setForm((prev) => ({ ...prev, basePrice: e.target.value }))}
            style={{ padding: "10px 12px", border: "1px solid var(--line)" }}
          />
          <input
            placeholder="Service fee (USD, optional)"
            value={form.serviceFee}
            onChange={(e) => setForm((prev) => ({ ...prev, serviceFee: e.target.value }))}
            style={{ padding: "10px 12px", border: "1px solid var(--line)" }}
          />
          <input
            placeholder="Delivery fee (USD, optional)"
            value={form.deliveryFee}
            onChange={(e) => setForm((prev) => ({ ...prev, deliveryFee: e.target.value }))}
            style={{ padding: "10px 12px", border: "1px solid var(--line)" }}
          />
          <input
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            style={{ padding: "10px 12px", border: "1px solid var(--line)" }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
            />
            Active
          </label>
        </div>
        <button
          type="button"
          disabled={!canSubmit || saving}
          onClick={handleCreate}
          style={{ marginTop: 16, padding: "8px 14px", cursor: saving ? "not-allowed" : "pointer" }}
        >
          {saving ? "Saving…" : "Add menu item"}
        </button>
      </section>

      <section style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>Current catalog</h2>
          <button type="button" onClick={load} style={{ padding: "6px 12px" }}>
            Refresh
          </button>
        </div>

        {items.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No menu items yet.</p>
        ) : (
          <div style={{ border: "1px solid var(--line)", background: "var(--paper)", overflowX: "auto", width: "100%" }}>
            <table style={{ minWidth: 900, width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--bg)" }}>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>ID</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Dish</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Restaurant</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Address</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Base</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Service</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Delivery</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Active</th>
                  <th style={{ textAlign: "right", padding: "12px 16px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid var(--grid)" }}>
                    <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)" }}>{item.id}</td>
                    <td style={{ padding: "12px 16px" }}>{item.dish_name}</td>
                    <td style={{ padding: "12px 16px" }}>{item.restaurant_name}</td>
                    <td style={{ padding: "12px 16px", color: "var(--muted)" }}>{item.restaurant_address ?? "—"}</td>
                    <td style={{ padding: "12px 16px" }}>{toUsd(item.base_price_cents)}</td>
                    <td style={{ padding: "12px 16px" }}>{toUsd(item.service_fee_cents)}</td>
                    <td style={{ padding: "12px 16px" }}>{toUsd(item.delivery_fee_cents)}</td>
                    <td style={{ padding: "12px 16px" }}>{item.is_active === 1 ? "Yes" : "No"}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        onClick={() => handleEditFees(item)}
                        style={{ padding: "6px 10px", marginRight: 8 }}
                      >
                        Edit fees
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(item)}
                        style={{ padding: "6px 10px" }}
                      >
                        {item.is_active === 1 ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>Orders</h2>
          <button type="button" onClick={load} style={{ padding: "6px 12px" }}>
            Refresh
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
          <div>
            <h3 style={{ fontSize: 16, margin: "0 0 8px" }}>Open orders</h3>
            {openOrders.length === 0 ? (
              <p style={{ color: "var(--muted)" }}>No open Snackpass orders.</p>
            ) : (
              <div style={{ border: "1px solid var(--line)", background: "var(--paper)", overflowX: "auto", width: "100%" }}>
                <table style={{ minWidth: 900, width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--bg)" }}>
                      <th style={{ textAlign: "left", padding: "12px 16px" }}>Order</th>
                      <th style={{ textAlign: "left", padding: "12px 16px" }}>Dish</th>
                      <th style={{ textAlign: "left", padding: "12px 16px" }}>Restaurant</th>
                      <th style={{ textAlign: "left", padding: "12px 16px" }}>Status</th>
                      <th style={{ textAlign: "left", padding: "12px 16px" }}>Total</th>
                      <th style={{ textAlign: "left", padding: "12px 16px" }}>Created</th>
                      <th style={{ textAlign: "right", padding: "12px 16px" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openOrders.map((order) => (
                      <tr key={order.id} style={{ borderBottom: "1px solid var(--grid)" }}>
                        <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)" }}>#{order.id}</td>
                        <td style={{ padding: "12px 16px" }}>{order.dish_name}</td>
                        <td style={{ padding: "12px 16px" }}>{order.restaurant_name}</td>
                        <td style={{ padding: "12px 16px" }}>{order.status}</td>
                        <td style={{ padding: "12px 16px" }}>{order.estimated_total ?? "—"}</td>
                        <td style={{ padding: "12px 16px", color: "var(--muted)", whiteSpace: "nowrap" }}>
                          {new Date(order.created_at).toLocaleString()}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>
                          <a href={`/admindash/snackpass/orders/${order.id}`} style={{ fontSize: 13 }}>
                            Open
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h3 style={{ fontSize: 16, margin: "0 0 8px" }}>Fulfilled or failed</h3>
            {closedOrders.length === 0 ? (
              <p style={{ color: "var(--muted)" }}>No completed Snackpass orders yet.</p>
            ) : (
              <div style={{ border: "1px solid var(--line)", background: "var(--paper)", overflowX: "auto", width: "100%" }}>
                <table style={{ minWidth: 900, width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--bg)" }}>
                      <th style={{ textAlign: "left", padding: "12px 16px" }}>Order</th>
                      <th style={{ textAlign: "left", padding: "12px 16px" }}>Dish</th>
                      <th style={{ textAlign: "left", padding: "12px 16px" }}>Restaurant</th>
                      <th style={{ textAlign: "left", padding: "12px 16px" }}>Status</th>
                      <th style={{ textAlign: "left", padding: "12px 16px" }}>Total</th>
                      <th style={{ textAlign: "left", padding: "12px 16px" }}>Updated</th>
                      <th style={{ textAlign: "right", padding: "12px 16px" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedOrders.map((order) => (
                      <tr key={order.id} style={{ borderBottom: "1px solid var(--grid)" }}>
                        <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)" }}>#{order.id}</td>
                        <td style={{ padding: "12px 16px" }}>{order.dish_name}</td>
                        <td style={{ padding: "12px 16px" }}>{order.restaurant_name}</td>
                        <td style={{ padding: "12px 16px" }}>{order.status}</td>
                        <td style={{ padding: "12px 16px" }}>{order.estimated_total ?? "—"}</td>
                        <td style={{ padding: "12px 16px", color: "var(--muted)", whiteSpace: "nowrap" }}>
                          {new Date(order.updated_at).toLocaleString()}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>
                          <a href={`/admindash/snackpass/orders/${order.id}`} style={{ fontSize: 13 }}>
                            Open
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Order fulfillment</h2>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Open a paid Snackpass order directly at <code>/admindash/snackpass/orders/&lt;orderId&gt;</code> to mark it fulfilled or failed.
        </p>
      </section>
    </main>
  );
}
