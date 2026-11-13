-- Nível 2 do copiloto: limite de pedidos de ajuste por mês no plano de teste.
update copiloto.planos
   set limites = jsonb_set(limites, '{ajuste_mes}', '50'::jsonb)
 where codigo = 'teste';
