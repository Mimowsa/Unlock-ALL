import {PayPalResult} from '@/features/paypal/result';import {ProtectedDemoPage} from '@/components/protected-demo-page';
export default async function Page({params}:{params:Promise<{locale:string;id:string}>}){const {locale,id}=await params;return <ProtectedDemoPage locale={locale} next="commande"><PayPalResult id={id}/></ProtectedDemoPage>;}
