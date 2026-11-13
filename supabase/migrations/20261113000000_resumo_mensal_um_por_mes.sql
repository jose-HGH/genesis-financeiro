-- Resumo do mês (passo 5): uma carta por mês, pedida a partir do dia 1 do mês seguinte.
update copiloto.planos
   set limites = jsonb_set(limites, '{resumo_mensal_mes}', '1'::jsonb)
 where codigo = 'teste';
