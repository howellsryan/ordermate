namespace ordermateAPI.DAL.Scripts;

public static class ProductOptionScripts
{
    public static string GetByProductId = "SELECT * FROM ProductOptions WHERE ProductId = @productId";
}