-- Nova permissão "contatos.exportar_ficha" (exportar os dados de UM paciente, pedido do titular).
-- Antes isso vinha junto com "editar contatos": Gestão e Recepção continuam podendo.
UPDATE clinic_roles
   SET permissions = array_append(permissions, 'contatos.exportar_ficha')
 WHERE system_key IN ('gestor', 'recepcao')
   AND NOT ('contatos.exportar_ficha' = ANY (permissions));
