namespace ordermateAPI.DAL.Scripts;

public static class ModifierScripts
{
    public static string GetByModifierId = "SELECT * FROM Modifiers WHERE ModifierId = @modifierId";
    public static string Get = "SELECT * FROM Modifiers";
    public static string GetByProductOptionId =
        "SELECT m.ModifierId, m.Name, m.Price, m.Quantity, m.CreatedDate, m.LastModifiedDate FROM productoptions po INNER JOIN ProductOptionModifiers pom ON po.ProductOptionId = pom.ProductOptionId INNER JOIN Modifiers m ON pom.ModifierId = m.ModifierId WHERE po.ProductOptionId = @productOptionId";
}