export type Role = "buyer" | "staff" | "owner";
export type AccountStatus = "pending" | "active" | "reset_required";
export const roleLabel: Record<Role, string> = { owner: "Owner", staff: "Staf", buyer: "Pelanggan" };
export const isOperator = (role: Role | undefined) => role === "owner" || role === "staff";
export interface PasswordLink {
  username: string;
  url: string;
  expires_at: number;
}
export type Status = "pending" | "review" | "approved" | "rejected" | "expired" | "shipped" | "completed";
export interface User {
  id: string;
  username: string;
  role: Role;
  status: AccountStatus;
}
export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  unit: string;
  price: number;
  stock: number;
  revision: number;
  photo_ids: string[];
}
export interface CartItem extends Product {
  quantity: number;
}
export interface Settings {
  shipping_fee: number | null;
  bank_name: string;
  bank_account: string;
  bank_holder: string;
  qris_id: string | null;
}
export interface Order {
  id: string;
  user_id: string | null;
  username?: string;
  status: Status;
  recipient: string;
  phone: string;
  address: string;
  subtotal: number;
  shipping_fee: number;
  total: number;
  payment_method: "bank" | "qris";
  payment_snapshot: string;
  proof_id: string | null;
  reason: string | null;
  courier: string | null;
  created_at: number;
  expires_at: number;
  proof_at: number | null;
  decided_at: number | null;
  items?: OrderItem[];
  events?: OrderEvent[];
}
export interface OrderItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  price: number;
}
export interface OrderEvent {
  actor_id?: string | null;
  actor_username?: string | null;
  id: string;
  status: Status;
  note: string | null;
  created_at: number;
}
export interface Session {
  id: string;
  device: string;
  created_at: number;
  last_seen: number;
  current: boolean;
}
export const statusLabel: Record<Status, string> = {
  pending: "Menunggu pembayaran",
  review: "Menunggu pemeriksaan",
  approved: "Pembayaran disetujui",
  rejected: "Ditolak",
  expired: "Kedaluwarsa",
  shipped: "Dikirim",
  completed: "Selesai",
};
export const money = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
export const date = (n: number) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(n) + " WIB";

export interface SalesReportData {
  summary: { orders: number; total: number; subtotal: number; shipping_fee: number };
  daily: { day: string; orders: number; total: number }[];
  products: { product_id: string; name: string; unit: string; quantity: number; subtotal: number }[];
  transactions: Pick<Order, "id" | "recipient" | "status" | "decided_at" | "subtotal" | "shipping_fee" | "total">[];
  page: number;
  operations: {
    orders: { status: Status; count: number }[];
    out_of_stock: { id: string; name: string; stock: number; unit: string }[];
    low_stock: { id: string; name: string; stock: number; unit: string }[];
    accounts: { role: Role; status: AccountStatus; count: number }[];
  };
}
