-- Nova permissão "config.ia" (Ajustes > Inteligência artificial). Vem ligada só para a Gestão;
-- a clínica libera para outros perfis em Perfis e permissões, se quiser.
UPDATE clinic_roles
   SET permissions = array_append(permissions, 'config.ia')
 WHERE system_key = 'gestor'
   AND NOT ('config.ia' = ANY (permissions));
