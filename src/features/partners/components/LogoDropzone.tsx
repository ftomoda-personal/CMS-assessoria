import { useEffect, useRef, useState } from 'react';
import { Button, Progress } from '@ftomoda/spectra-design-system';
import { CloudUpload, CircleAlert, File as FileIcon } from 'lucide-react';
import { logoAccept, simulateLogoUpload, validateLogo } from '../upload';

export function LogoDropzone({ onChange }: { onChange: (file: File | undefined, uploading: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<(() => void) | undefined>(undefined);
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [error, setError] = useState<string>();
  const [state, setState] = useState<'empty' | 'uploading' | 'complete' | 'invalid' | 'failed'>('empty');
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  useEffect(() => () => cancel.current?.(), []);
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) { setPreview(undefined); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function select(selected: File) {
    cancel.current?.();
    setFile(selected);
    setProgress(0);
    const message = validateLogo(selected);
    setError(message);
    if (message) { setState('invalid'); onChange(undefined, false); return; }
    setState('uploading');
    onChange(undefined, true);
    // Explicit developer fixture; ordinary files never fail randomly.
    const fail = import.meta.env.DEV && selected.name.startsWith('simulate-upload-failure.');
    cancel.current = simulateLogoUpload(setProgress, failed => {
      setState(failed ? 'failed' : 'complete');
      setError(failed ? 'Não foi possível carregar a imagem, tente novamente' : undefined);
      onChange(failed ? undefined : selected, false);
    }, fail);
  }
  return <div className="logo-upload">
    <label htmlFor="partner-logo">Logo</label>
    <input ref={input} className="logo-native-input" id="partner-logo" type="file" accept={logoAccept} aria-describedby="logo-feedback" aria-invalid={Boolean(error)} onChange={event => { const selected = event.target.files?.[0]; if (selected) select(selected); event.target.value = ''; }} />
    <div className={`logo-dropzone logo-dropzone--${state}${dragging ? ' logo-dropzone--dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); const selected = event.dataTransfer.files[0]; if (selected) select(selected); }}>
      {state !== 'uploading' && (state === 'failed' ? <CircleAlert size={48} aria-hidden="true" /> : file && preview ? <img className="logo-preview" src={preview} alt="" /> : <CloudUpload size={48} aria-hidden="true" />)}
      <p className="logo-filename">{file ? file.name : 'Arraste a imagem aqui ou selecione um arquivo'}</p>
      {(state === 'uploading' || state === 'failed') && <Progress value={progress} aria-label="Envio do logo" />}
      <div id="logo-feedback" aria-live="polite" className={state === 'invalid' ? 'logo-feedback logo-feedback--error' : 'logo-feedback'}>
        {state === 'uploading' ? <div className="logo-progress-caption"><span>Enviando arquivo ...</span><span>{progress}%</span></div> : state === 'failed' ? <><p className="logo-failure-title">Falha no envio</p><p>{error}</p></> : <p>{error ?? (file ? `${Math.round(file.size / 1024)} KB` : 'PNG, JPG ou SVG - Max. 2MB')}</p>}
      </div>
      {state !== 'uploading' && <Button type="button" variant={file ? 'tertiary' : 'primary'} size={file ? 'sm' : 'md'} leadingIcon={<FileIcon size={16} aria-hidden="true" />} onClick={() => input.current?.click()}>{file ? 'Trocar arquivo' : 'Selecionar arquivo'}</Button>}
    </div>
  </div>;
}
