import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Input, Toast } from '@ftomoda/spectra-design-system';
import { Save, X } from 'lucide-react';
import { PageHeader } from '../../../components/PageHeader';
import { navigate } from '../../../app/routes';
import { partnerRepository } from '../repository';
import type { PartnerStatus } from '../model';
import { LogoDropzone } from '../components/LogoDropzone';
import '../create-partner.css';

export type PartnerNotice = { partnerId: string; variant: 'success'; title: string; description: string };
export function CreatePartnerPage({ initialStatus, onCreated }: { initialStatus: PartnerStatus; onCreated: (notice: PartnerNotice) => void }) {
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [logo, setLogo] = useState<File>();
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const complete = Boolean(name.trim() && website.trim() && !uploading);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete) return;
    let temporaryUrl: string | undefined;
    const id = crypto.randomUUID();
    try {
      temporaryUrl = logo ? URL.createObjectURL(logo) : undefined;
      partnerRepository.save({ id, name: name.trim(), website: website.trim(), status: initialStatus, logoUrl: temporaryUrl, logoKind: temporaryUrl ? 'session-object-url' : undefined });
    } catch {
      if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
      setSaveError(true);
      return;
    }
    onCreated({ partnerId: id, variant: 'success', title: 'Parceiro adicionado', description: `${name.trim()} foi adicionado com sucesso.` });
  }
  return <div className="create-partner">
    <PageHeader title="ADICIONAR PARCEIRO" />
    {saveError && <Toast className="creation-toast" variant="error" title="Não foi possível adicionar o parceiro" description="Por favor tente novamente mais tarde." closeLabel="Fechar notificação" onDismiss={() => setSaveError(false)} />}
    <form aria-label="Criar parceiro" onSubmit={submit}>
      <div className="create-partner-fields">
        <Input label="Nome" name="name" required placeholder="ex: Nubank" value={name} onChange={event => setName(event.target.value)} />
        <Input label="Link" name="website" required placeholder="ex: nubank.com.br" value={website} onChange={event => setWebsite(event.target.value)} />
        <LogoDropzone onChange={(file, busy) => { setLogo(file); setUploading(busy); }} />
      </div>
      <div className="create-partner-actions">
        <Button type="button" variant="tertiary" leadingIcon={<X size={16} aria-hidden="true" />} onClick={() => navigate('/partners')}>Cancelar</Button>
        <Button type="submit" disabled={!complete} leadingIcon={<Save size={16} aria-hidden="true" />}>Salvar</Button>
      </div>
    </form>
  </div>;
}
