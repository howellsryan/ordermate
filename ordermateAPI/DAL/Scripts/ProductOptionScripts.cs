namespace ordermateAPI.DAL.Scripts;

public static class ProductOptionScripts
{
    public static string Get = "SELECT * FROM ProductOptions WHERE ProductOptionId = @productOptionId";
    public static string GetByProductId = "SELECT * FROM ProductOptions WHERE ProductId = @productId";
}