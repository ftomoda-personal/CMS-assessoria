import { EditPartnerPage } from "../features/partners/pages/EditPartnerPage";
import { CreatePartnerPage } from "../features/partners/pages/CreatePartnerPage";
import type { PartnerNotice } from "../features/partners/pages/CreatePartnerPage";
import { PartnerListPage } from "../features/partners/pages/PartnerListPage";
import { useEffect, useState } from "react";
import { CreateOfferPage } from "../features/offers/pages/CreateOfferPage";
import { EditOfferPage } from "../features/offers/pages/EditOfferPage";
import type { OfferNotice } from "../features/offers/creation";
import { navigate } from "./routes";
import { PageHeader } from "../components/PageHeader";
import { AppLayout } from "./layout/AppLayout";
import { useRoute } from "./routes";
import { ThemeProvider } from "./theme";
import { AuthProvider } from "./auth";
import { AuthRouteBoundary } from "./AuthRouteBoundary";
import { OfferListPage } from "../features/offers/pages/OfferListPage";

function Application() {
  const route = useRoute();
  const [partnerNotice, setPartnerNotice] = useState<PartnerNotice | null>(null);
  const [notice, setNotice] = useState<OfferNotice | null>(null);
  useEffect(() => {
    document.getElementById("main-content")?.focus({ preventScroll: true });
    if (route?.page !== "partner-list") setPartnerNotice(null);
    if (route?.page !== "offer-list") setNotice(null);
  }, [route?.page, route?.offerId, route?.partnerId]);
  return <AppLayout section={route?.section}>
    {route?.page === "partner-list" ? <PartnerListPage notice={partnerNotice} onDismissNotice={() => setPartnerNotice(null)} /> : route?.page === "partner-create" ? <CreatePartnerPage onCreated={result => { setPartnerNotice(result); navigate("/partners"); }} /> : route?.page === "partner-edit" ? <EditPartnerPage key={route.partnerId} partnerId={route.partnerId ?? ""} onSaved={result => { setPartnerNotice(result); navigate("/partners"); }} /> : route?.page === "offer-list" ? <OfferListPage notice={notice} onDismissNotice={() => setNotice(null)} /> : route?.page === "offer-create" ? <CreateOfferPage onCreated={result => { setNotice(result); navigate("/offers"); }} /> : route?.page === "offer-edit" ? <EditOfferPage key={route.offerId} offerId={route.offerId ?? ""} onSaved={result => { setNotice(result); navigate("/offers"); }} /> : <>
    <PageHeader title={route?.title ?? "PÁGINA NÃO ENCONTRADA"} description={route?.description} />
    <section className="foundation-placeholder" aria-label="Conteúdo provisório">
      <p>{route ? "Conteúdo disponível em uma próxima etapa." : "Escolha Ofertas ou Parceiros na navegação."}</p>
    </section>
    </>}
  </AppLayout>;
}

export default function App() {
  return <ThemeProvider><AuthProvider><AuthRouteBoundary><Application /></AuthRouteBoundary></AuthProvider></ThemeProvider>;
}
