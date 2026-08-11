"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type Role = "customer" | "driver";
type Profile = { id: string; full_name: string; phone: string; role: Role | "admin"; vehicle_type: string | null };
type Delivery = {
  id: string; customer_id: string; driver_id: string | null; pickup_name: string; pickup_address: string;
  dropoff_address: string; item_description: string; customer_phone: string; notes: string;
  requested_for: string | null; estimated_fee: number; status: string; created_at: string;
};

const statusLabel: Record<string, string> = {
  requested: "Finding a driver", accepted: "Driver accepted", collecting: "Collecting your order",
  on_way: "On the way", delivered: "Delivered", cancelled: "Cancelled",
};

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    bag: <><path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></>,
    truck: <><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, check: <path d="m5 12 4 4L19 6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("signup");
  const [accountType, setAccountType] = useState<Role>("customer");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);

  const loadData = useCallback(async (userId: string) => {
    const { data: p, error } = await supabase.from("profiles").select("id,full_name,phone,role,vehicle_type").eq("id", userId).single();
    if (error) { setNotice(error.message); return; }
    const typed = p as Profile;
    setProfile(typed);
    const query = supabase.from("delivery_requests").select("*").order("created_at", { ascending: false });
    const { data, error: deliveryError } = await query;
    if (deliveryError) setNotice(deliveryError.message); else setDeliveries((data ?? []) as Delivery[]);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await loadData(data.session.user.id);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next); setProfile(null); setDeliveries([]);
      if (next) setTimeout(() => loadData(next.user.id), 0);
    });
    return () => listener.subscription.unsubscribe();
  }, [loadData]);

  useEffect(() => {
    if (!session) return;
    const channel = supabase.channel(`deliveries-${session.user.id}`).on("postgres_changes", { event: "*", schema: "public", table: "delivery_requests" }, () => loadData(session.user.id)).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session, loadData]);

  async function authenticate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setNotice("");
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (authMode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setNotice(error.message); else setAuthOpen(false);
      return;
    }
    const full_name = String(form.get("full_name") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    const vehicle_type = String(form.get("vehicle_type") ?? "");
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name, phone, account_type: accountType, vehicle_type } } });
    if (error) setNotice(error.message);
    else if (!data.session) setNotice("Account created. Check your email to confirm, then log in.");
    else setAuthOpen(false);
  }

  async function createRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!session || !profile) return;
    const form = new FormData(e.currentTarget);
    const payload = {
      customer_id: session.user.id, pickup_name: String(form.get("pickup_name")),
      pickup_address: String(form.get("pickup_address")), dropoff_address: String(form.get("dropoff_address")),
      item_description: String(form.get("item_description")), customer_phone: String(form.get("phone")),
      notes: String(form.get("notes") ?? ""), requested_for: form.get("requested_for") ? new Date(String(form.get("requested_for"))).toISOString() : null,
      estimated_fee: 7.5, status: "requested",
    };
    const { error } = await supabase.from("delivery_requests").insert(payload);
    if (error) setNotice(error.message); else { setRequestOpen(false); setNotice("Delivery request sent — a driver can now accept it."); await loadData(session.user.id); }
  }

  async function acceptJob(id: string) {
    if (!session) return;
    const { data, error } = await supabase.from("delivery_requests").update({ driver_id: session.user.id, status: "accepted", accepted_at: new Date().toISOString() }).eq("id", id).eq("status", "requested").select();
    if (error) setNotice(error.message); else if (!data?.length) setNotice("Another driver has already accepted this delivery.");
    await loadData(session.user.id);
  }

  async function progressJob(job: Delivery) {
    if (!session) return;
    const next: Record<string, string> = { accepted: "collecting", collecting: "on_way", on_way: "delivered" };
    const status = next[job.status]; if (!status) return;
    const update: Record<string, string> = { status };
    if (status === "delivered") update.completed_at = new Date().toISOString();
    const { error } = await supabase.from("delivery_requests").update(update).eq("id", job.id).eq("driver_id", session.user.id);
    if (error) setNotice(error.message); await loadData(session.user.id);
  }

  const available = useMemo(() => deliveries.filter(d => d.status === "requested"), [deliveries]);
  const assigned = useMemo(() => deliveries.filter(d => d.driver_id === session?.user.id), [deliveries, session]);

  if (loading) return <div className="loading-screen"><img src="/onit.svg" alt="Onit"/><span>Getting Onit…</span></div>;
  if (session && profile) return <Dashboard profile={profile} deliveries={deliveries} available={available} assigned={assigned} notice={notice} setNotice={setNotice} onNew={() => setRequestOpen(true)} onAccept={acceptJob} onProgress={progressJob} onLogout={() => supabase.auth.signOut()} />;

  return <main>
    <section className="hero-shell">
      <nav className="nav-wrap"><img src="/onit.svg" alt="Onit" className="brand-img"/><div className="nav-links"><a href="#how">How it works</a><a href="#drivers">Drive with Onit</a></div><div className="nav-actions"><button className="login" onClick={() => { setAuthMode("login"); setAuthOpen(true); }}>Log in</button><button className="signup" onClick={() => { setAuthMode("signup"); setAccountType("customer"); setAuthOpen(true); }}>Sign up</button></div></nav>
      <div className="hero"><div className="hero-copy"><span className="eyebrow">WATERFORD&apos;S LOCAL DELIVERY SERVICE</span><h1>Whatever you need,<br/><em>we&apos;re Onit.</em></h1><p>Need something collected? Create a request in minutes and a local Onit driver will take it from there.</p><div className="hero-actions"><button className="primary" onClick={() => { setAuthMode("signup"); setAccountType("customer"); setAuthOpen(true); }}>Request a delivery <Icon name="arrow"/></button><button className="secondary" onClick={() => { setAuthMode("signup"); setAccountType("driver"); setAuthOpen(true); }}>Become a driver</button></div><div className="trust-row"><span>✓ Real-time updates</span><span>✓ Local drivers</span><span>✓ From €7.50</span></div></div>
      <div className="hero-visual"><div className="orange-orbit"/><div className="phone"><div className="phone-logo"><img src="/onit.svg" alt=""/></div><p className="phone-hi">Good morning, Liezel</p><h3>What do you need delivered?</h3><div className="phone-field"><Icon name="pin"/> Collection address</div><div className="phone-field"><Icon name="bag"/> What are we collecting?</div><button>Request delivery</button><div className="live-card"><span className="pulse"/><div><small>DRIVER ON THE WAY</small><strong>Shane · 8 mins away</strong></div></div></div></div></div>
    </section>
    <section className="how-section" id="how"><span className="eyebrow">DELIVERY MADE SIMPLE</span><h2>From request to your door.</h2><div className="how-grid"><article><b>01</b><Icon name="plus" size={28}/><h3>Create your request</h3><p>Tell us where to collect, where to deliver and what your driver needs to know.</p></article><article><b>02</b><Icon name="truck" size={28}/><h3>A driver accepts</h3><p>A local Onit driver claims your request and keeps the status updated.</p></article><article><b>03</b><Icon name="check" size={28}/><h3>Delivered</h3><p>Follow every step from collection to delivery in your account.</p></article></div></section>
    <section className="driver-cta" id="drivers"><div><span className="eyebrow">DRIVE ON YOUR TERMS</span><h2>Local routes.<br/>Extra income.</h2><p>Create a driver account, see available requests and choose the jobs that work for you.</p><button className="primary" onClick={() => { setAuthMode("signup"); setAccountType("driver"); setAuthOpen(true); }}>Sign up as a driver <Icon name="arrow"/></button></div><div className="driver-route-art" aria-label="Illustration of an Onit delivery route">
  <div className="route-copy"><span>ONIT DRIVER NETWORK</span><strong>You drive.<br/>We keep you moving.</strong></div>
  <svg className="route-line" viewBox="0 0 520 300" fill="none" aria-hidden="true">
    <path d="M75 238C143 236 132 91 236 106C323 119 330 215 445 166" />
    <path className="route-dashes" d="M75 238C143 236 132 91 236 106C323 119 330 215 445 166" />
  </svg>
  <div className="route-place route-shop"><span><Icon name="bag" size={19}/></span><small>COLLECT</small><b>Local shop</b></div>
  <div className="route-place route-home"><span><Icon name="pin" size={19}/></span><small>DELIVER</small><b>Customer</b></div>
  <div className="driver-marker"><span><Icon name="truck" size={25}/></span><div><small>ONIT DRIVER</small><b>8 mins away</b></div></div>
  <div className="route-status"><i/><span><small>DELIVERY AVAILABLE</small><b>Waterford · €8.50</b></span></div>
</div></section>
    <footer><img src="/onit-white.svg" alt="Onit"/><span>Waterford&apos;s local delivery service.</span><small>© 2026 Onit Delivery</small></footer>
    {authOpen && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setAuthOpen(false)}><div className="auth-card"><button className="modal-close" onClick={() => setAuthOpen(false)}>×</button><img src="/onit.svg" alt="Onit"/><h2>{authMode === "login" ? "Welcome back" : accountType === "driver" ? "Drive with Onit" : "Create your account"}</h2><p>{authMode === "login" ? "Log in to manage your deliveries." : "You’ll be ready in under a minute."}</p>{authMode === "signup" && <div className="role-tabs"><button className={accountType === "customer" ? "active" : ""} onClick={() => setAccountType("customer")}><Icon name="user"/> Customer</button><button className={accountType === "driver" ? "active" : ""} onClick={() => setAccountType("driver")}><Icon name="truck"/> Driver</button></div>}<form onSubmit={authenticate}>{authMode === "signup" && <><label>Full name<input name="full_name" required placeholder="Your full name"/></label><label>Phone number<input name="phone" type="tel" required placeholder="08X XXX XXXX"/></label>{accountType === "driver" && <label>Vehicle<select name="vehicle_type" required defaultValue=""><option value="" disabled>Select your vehicle</option><option>Car</option><option>Van</option><option>Motorbike</option><option>Bicycle</option></select></label>}</>}<label>Email address<input name="email" type="email" required placeholder="you@email.com"/></label><label>Password<input name="password" type="password" minLength={8} required placeholder="At least 8 characters"/></label><button className="auth-submit" type="submit">{authMode === "login" ? "Log in" : "Create account"} <Icon name="arrow"/></button></form>{notice && <p className="form-notice">{notice}</p>}<button className="switch-auth" onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setNotice(""); }}>{authMode === "login" ? "New to Onit? Create an account" : "Already have an account? Log in"}</button></div></div>}
    {requestOpen && profile && <RequestModal profile={profile} onClose={() => setRequestOpen(false)} onSubmit={createRequest}/>} 
  </main>;
}

function Dashboard({ profile, deliveries, available, assigned, notice, setNotice, onNew, onAccept, onProgress, onLogout }: { profile: Profile; deliveries: Delivery[]; available: Delivery[]; assigned: Delivery[]; notice: string; setNotice: (v:string)=>void; onNew:()=>void; onAccept:(id:string)=>void; onProgress:(d:Delivery)=>void; onLogout:()=>void }) {
  const driver = profile.role === "driver";
  const jobs = driver ? assigned : deliveries;
  return <main className="dashboard"><aside><img src="/onit-white.svg" alt="Onit"/><div className="side-user"><span>{profile.full_name.slice(0,1).toUpperCase()}</span><div><strong>{profile.full_name}</strong><small>{driver ? `${profile.vehicle_type ?? "Driver"} driver` : "Customer"}</small></div></div><nav><a className="active"><Icon name={driver ? "truck" : "bag"}/> {driver ? "My deliveries" : "My requests"}</a><a><Icon name="user"/> Account</a></nav><button onClick={onLogout}><Icon name="logout"/> Log out</button></aside><section className="dash-main"><header><div><span className="eyebrow">{driver ? "DRIVER DASHBOARD" : "CUSTOMER DASHBOARD"}</span><h1>{driver ? "Ready when you are." : `Hello, ${profile.full_name.split(" ")[0]}.`}</h1><p>{driver ? "Choose an available delivery and keep the customer updated." : "Request a collection and follow its journey here."}</p></div>{!driver && <button className="primary" onClick={onNew}><Icon name="plus"/> New delivery request</button>}</header>{notice && <div className="dash-notice"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}{driver && <><div className="dash-title"><h2>Available nearby</h2><span>{available.length} open</span></div><div className="job-grid">{available.length ? available.map(d => <JobCard key={d.id} job={d} action={<button onClick={() => onAccept(d.id)}>Accept delivery <Icon name="arrow" size={17}/></button>}/>) : <Empty text="No open requests right now. New jobs will appear here live."/>}</div></>}<div className="dash-title"><h2>{driver ? "My active deliveries" : "Your deliveries"}</h2><span>{jobs.length} total</span></div><div className="job-list">{jobs.length ? jobs.map(d => <JobCard key={d.id} job={d} customer={!driver} action={driver && d.status !== "delivered" ? <button onClick={() => onProgress(d)}>{d.status === "accepted" ? "Mark collecting" : d.status === "collecting" ? "Start delivery" : "Mark delivered"} <Icon name="arrow" size={17}/></button> : undefined}/>) : <Empty text={driver ? "You haven’t accepted a delivery yet." : "Your first delivery request will appear here."}/>}</div></section></main>;
}

function JobCard({ job, action, customer = false }: { job: Delivery; action?: React.ReactNode; customer?: boolean }) {
  return <article className="job-card"><div className="job-top"><span className={`status ${job.status}`}>{statusLabel[job.status]}</span><strong>€{Number(job.estimated_fee).toFixed(2)}</strong></div><h3>{job.pickup_name}</h3><p className="item">{job.item_description}</p><div className="route"><div><i/><span><small>COLLECT FROM</small>{job.pickup_address}</span></div><div><i/><span><small>DELIVER TO</small>{job.dropoff_address}</span></div></div><div className="job-foot"><span><Icon name="clock" size={16}/>{new Date(job.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</span>{action}</div>{customer && <div className="progress"><i className={job.status !== "requested" ? "done" : ""}/><i className={["collecting","on_way","delivered"].includes(job.status) ? "done" : ""}/><i className={["on_way","delivered"].includes(job.status) ? "done" : ""}/><i className={job.status === "delivered" ? "done" : ""}/></div>}</article>;
}

function Empty({ text }: { text: string }) { return <div className="empty"><Icon name="bag" size={32}/><p>{text}</p></div>; }

function RequestModal({ profile, onClose, onSubmit }: { profile: Profile; onClose:()=>void; onSubmit:(e:FormEvent<HTMLFormElement>)=>void }) {
  return <div className="modal-backdrop"><div className="request-card"><button className="modal-close" onClick={onClose}>×</button><span className="eyebrow">NEW REQUEST</span><h2>What can we collect?</h2><p>Enter the collection details and we&apos;ll make it available to nearby drivers.</p><form onSubmit={onSubmit}><div className="two-fields"><label>Collection place<input name="pickup_name" required placeholder="e.g. Tesco Ardkeen"/></label><label>Your phone<input name="phone" required defaultValue={profile.phone}/></label></div><label>Collection address<input name="pickup_address" required placeholder="Full collection address"/></label><label>Delivery address<input name="dropoff_address" required placeholder="Your delivery address"/></label><label>What are we collecting?<textarea name="item_description" required placeholder="Describe the order or parcel clearly"/></label><div className="two-fields"><label>Preferred time<input name="requested_for" type="datetime-local"/></label><label>Driver notes<input name="notes" placeholder="Order number, access details…"/></label></div><div className="fee-row"><span>Estimated delivery fee<small>Payment arranged on delivery for this first release</small></span><strong>€7.50</strong></div><button className="auth-submit" type="submit">Send delivery request <Icon name="arrow"/></button></form></div></div>;
}
